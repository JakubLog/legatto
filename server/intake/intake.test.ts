import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import vectors from '../../packages/public-submission/test/vectors.json';
import {
  buildEnvelope,
  encryptPlaintext,
  fromBase64,
  KIND_SUBMISSION,
  pad,
  seal,
  toBase64,
  x25519RandomSecret,
  type EnvelopeMeta,
  type SubmissionPlaintext,
} from '../../packages/public-submission/src/index';
import { ConfigError, formatFormKeyLine, parseFormKeys } from './config';
import { runFetch } from './fetch';
import { HttpClient } from './http';
import { runProcess, type SubmitFn } from './process';
import { QueueClient } from './queue';
import { Spool, type AckRecord } from './spool';

const ACCOUNT = 'a'.repeat(32);
const FORMS = 'b'.repeat(32);
const DLQ = 'c'.repeat(32);
const officeSecret = fromBase64(vectors.keys.office_x25519_secret);
const officePublic = fromBase64(vectors.keys.office_x25519_public);
const workerSeed = fromBase64(vectors.keys.worker_ed25519_seed);
const signers = new Map([[vectors.keys.worker_kid, fromBase64(vectors.keys.worker_ed25519_public)]]);
const officeKeys = new Map([[vectors.keys.office_kid, officeSecret]]);
const RECEIVED_AT = Date.parse('2026-11-21T12:00:01.000Z');
const now = () => RECEIVED_AT + 60_000;

function envelopeFor(plaintext: SubmissionPlaintext, receivedAt = RECEIVED_AT): string {
  return toBase64(
    buildEnvelope({
      kind: KIND_SUBMISSION,
      officePublic,
      signerSeed: workerSeed,
      receivedAt,
      meta: vectors.submission.meta as EnvelopeMeta,
      ct: encryptPlaintext(plaintext, officePublic),
    }),
  );
}

interface FakeQueueState {
  messages: Record<string, { id: string; lease_id: string; body: string; attempts: number; timestamp_ms: number }[]>;
  acked: string[];
  retried: string[];
  invalidLeases: string[];
  failingLeases: string[];
  authHeaders: string[];
}

function startFakeCf(state: FakeQueueState): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      state.authHeaders.push(req.headers.authorization ?? '');
      const match = /^\/client\/v4\/accounts\/([0-9a-f]{32})\/queues\/([0-9a-f]{32})\/messages\/(pull|ack)$/.exec(req.url ?? '');
      res.setHeader('Content-Type', 'application/json');
      if (!match || match[1] !== ACCOUNT) {
        res.statusCode = 404;
        res.end(JSON.stringify({ success: false, errors: [{ code: 404, message: 'not found' }] }));
        return;
      }
      const parsed = JSON.parse(body) as {
        batch_size?: number;
        acks?: { lease_id: string }[];
        retries?: { lease_id: string }[];
      };
      if (match[3] === 'pull') {
        const queue = state.messages[match[2]] ?? [];
        const batch = queue.splice(0, parsed.batch_size ?? 10);
        res.end(JSON.stringify({ success: true, result: { messages: batch, message_backlog_count: queue.length } }));
        return;
      }
      const leases = [...(parsed.acks ?? []), ...(parsed.retries ?? [])].map((a) => a.lease_id);
      if (leases.some((l) => state.failingLeases.includes(l))) {
        res.statusCode = 503;
        res.end(JSON.stringify({ success: false, errors: [{ code: 503, message: 'temporarily unavailable' }] }));
        return;
      }
      if (leases.some((l) => state.invalidLeases.includes(l))) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, errors: [{ code: 400, message: 'lease id invalid or expired' }] }));
        return;
      }
      state.acked.push(...(parsed.acks ?? []).map((a) => a.lease_id));
      state.retried.push(...(parsed.retries ?? []).map((a) => a.lease_id));
      res.end(JSON.stringify({ success: true, result: { ackCount: parsed.acks?.length ?? 0 } }));
    });
  });
  const { promise, resolve } = Promise.withResolvers<{ base: string; close: () => Promise<void> }>();
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo;
    resolve({
      base: `http://127.0.0.1:${port}/client/v4`,
      close: () => {
        const closed = Promise.withResolvers<void>();
        server.close(() => closed.resolve());
        return closed.promise;
      },
    });
  });
  return promise;
}

let root: string;
let spool: Spool;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'legatto-intake-'));
  for (const d of ['inbox', 'acks', 'quarantine']) mkdirSync(join(root, d));
  spool = new Spool(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const fetchOptions = { queues: { forms: FORMS, dlq: DLQ }, batchSize: 10, visibilityTimeoutMs: 900_000, retryDelaySeconds: 300, maxBatches: 5 };

describe('intake: fetch → process → ack (dwa procesy)', () => {
  it('pełny cykl: zapis do bazy, ack dopiero po zapisie, duplikat i zły podpis', async () => {
    const valid = envelopeFor(vectors.submission.plaintext as SubmissionPlaintext);
    const tampered = fromBase64(valid);
    tampered[1000] ^= 1;
    const state: FakeQueueState = {
      messages: {
        [FORMS]: [
          { id: 'msg-1', lease_id: 'lease-1', body: valid, attempts: 1, timestamp_ms: RECEIVED_AT },
          { id: 'msg-2', lease_id: 'lease-2', body: valid, attempts: 1, timestamp_ms: RECEIVED_AT },
          { id: 'msg-3', lease_id: 'lease-3', body: toBase64(tampered), attempts: 1, timestamp_ms: RECEIVED_AT },
        ],
        [DLQ]: [],
      },
      acked: [],
      retried: [],
      invalidLeases: [],
      failingLeases: [],
      authHeaders: [],
    };
    const cf = await startFakeCf(state);
    try {
      const queue = new QueueClient(new HttpClient(), cf.base, ACCOUNT, 'test-token');
      const fetch1 = await runFetch(spool, queue, fetchOptions);
      expect(fetch1).toMatchObject({ ok: true, pulled: 3, acked: 0, backlog: 0 });
      expect(state.acked).toEqual([]);
      expect(readdirSync(spool.inbox).sort()).toEqual(['msg-1.json', 'msg-2.json', 'msg-3.json']);
      // inbox nie zawiera jawnej treści
      expect(readFileSync(join(spool.inbox, 'msg-1.json'), 'utf8')).not.toContain('Dziura');

      const db = new Set<string>();
      const calls: Record<string, unknown>[] = [];
      const submit: SubmitFn = async (payload) => {
        calls.push(payload);
        const id = String(payload.id);
        if (db.has(id)) return 'duplicate';
        db.add(id);
        return 'inserted';
      };
      const processed = await runProcess(spool, { signers, officeKeys, submit, now });
      expect(processed).toMatchObject({ ok: true, processed: 3, inserted: 1, duplicate: 1, quarantined: 1, retry: 0 });
      expect(calls[0]).toMatchObject({
        id: vectors.submission.plaintext.id,
        kind: 'submission',
        received_at: '2026-11-21T12:00:01.000Z',
        meta: { ip_hash: 'a'.repeat(64), ua: 'Mozilla/5.0' },
      });
      expect(calls[0].form).toMatchObject({ title: vectors.submission.plaintext.form.title });
      expect(readdirSync(spool.inbox)).toEqual([]);
      expect(readdirSync(spool.quarantine).sort()).toEqual(['msg-3.bin', 'msg-3.json']);
      expect(JSON.parse(readFileSync(join(spool.quarantine, 'msg-3.json'), 'utf8')).reason).toBe('bad_signature');

      const fetch2 = await runFetch(spool, queue, fetchOptions);
      expect(fetch2).toMatchObject({ ok: true, acked: 3, pulled: 0 });
      expect(state.acked.sort()).toEqual(['lease-1', 'lease-2', 'lease-3']);
      expect(readdirSync(spool.acks)).toEqual([]);
      expect(new Set(state.authHeaders)).toEqual(new Set(['Bearer test-token']));
    } finally {
      await cf.close();
    }
  });

  it('błąd bazy = retry; ponowne doręczenie odświeża lease_id; wygasła dzierżawa usuwa wpis', async () => {
    const valid = envelopeFor(vectors.submission.plaintext as SubmissionPlaintext);
    const state: FakeQueueState = {
      messages: { [FORMS]: [{ id: 'm1', lease_id: 'old', body: valid, attempts: 1, timestamp_ms: RECEIVED_AT }] },
      acked: [],
      retried: [],
      invalidLeases: ['expired'],
      failingLeases: [],
      authHeaders: [],
    };
    const cf = await startFakeCf(state);
    try {
      const queue = new QueueClient(new HttpClient(), cf.base, ACCOUNT, 't');
      await runFetch(spool, queue, fetchOptions);
      const failing: SubmitFn = async () => {
        throw new Error('connection refused');
      };
      const res = await runProcess(spool, { signers, officeKeys, submit: failing, now });
      expect(res).toMatchObject({ ok: false, retry: 1 });
      expect(spool.readJson<AckRecord>(spool.acks, 'm1')).toMatchObject({ action: 'retry', outcome: 'error', lease_id: 'old' });

      // Redelivery zanim ack poszedł: lease_id w acks/ podmieniony.
      state.messages[FORMS].push({ id: 'm1', lease_id: 'new', body: valid, attempts: 2, timestamp_ms: RECEIVED_AT });
      state.invalidLeases.push('old');
      const f = await runFetch(spool, queue, fetchOptions);
      // najpierw ack starej dzierżawy (nieważna → usunięty), potem pull nowej wiadomości do inbox/
      expect(f.ack_pending).toBe(0);
      expect(spool.exists(spool.inbox, 'm1')).toBe(true);
      expect(spool.readJson<{ lease_id: string }>(spool.inbox, 'm1').lease_id).toBe('new');

      // Ack nie przechodzi (błąd przejściowy CF), wiadomość przychodzi ponownie → odświeżenie lease w acks/.
      await runProcess(spool, { signers, officeKeys, submit: async () => 'inserted', now });
      state.messages[FORMS].push({ id: 'm1', lease_id: 'newer', body: valid, attempts: 3, timestamp_ms: RECEIVED_AT });
      state.failingLeases.push('new');
      const g = await runFetch(spool, queue, fetchOptions);
      expect(g).toMatchObject({ ok: false, ack_pending: 1, refreshed: 1 });
      expect(spool.readJson<AckRecord>(spool.acks, 'm1').lease_id).toBe('newer');
      await runFetch(spool, queue, fetchOptions);
      expect(state.acked).toContain('newer');
      expect(spool.exists(spool.acks, 'm1')).toBe(false);
    } finally {
      await cf.close();
    }
  });

  it('kwarantanna: przeterminowana koperta, nieznany klucz biura, uszkodzony rekord', async () => {
    const old = envelopeFor(vectors.submission.plaintext as SubmissionPlaintext, RECEIVED_AT - 17 * 24 * 3600 * 1000);
    spool.writeAtomic(spool.inbox, 'old', JSON.stringify({ v: 1, queue: 'forms', msg_id: 'old', lease_id: 'l1', attempts: 1, timestamp_ms: 0, body_b64: old }));
    const valid = envelopeFor(vectors.submission.plaintext as SubmissionPlaintext);
    spool.writeAtomic(spool.inbox, 'nokey', JSON.stringify({ v: 1, queue: 'dlq', msg_id: 'nokey', lease_id: 'l2', attempts: 1, timestamp_ms: 0, body_b64: valid }));
    spool.writeAtomic(spool.inbox, 'broken', '{"v":1,');
    const submit: SubmitFn = async () => 'inserted';
    const res = await runProcess(spool, { signers, officeKeys: new Map([['0'.repeat(16), x25519RandomSecret()]]), submit, now });
    expect(res).toMatchObject({ quarantined: 3, inserted: 0 });
    const reasons = Object.fromEntries(
      ['old', 'nokey', 'broken'].map((id) => [id, JSON.parse(readFileSync(join(spool.quarantine, `${id}.json`), 'utf8')).reason]),
    );
    expect(reasons).toEqual({ old: 'expired', nokey: 'unknown_office_kid', broken: 'bad_record' });
    expect(spool.readJson<AckRecord>(spool.acks, 'nokey')).toMatchObject({ queue: 'dlq', action: 'ack', outcome: 'quarantined' });
    expect(spool.exists(spool.acks, 'broken')).toBe(false);
  });

  it('niepoprawna treść formularza trafia do SQL jako invalid (pokwitowanie, nie kwarantanna)', async () => {
    const plaintext = { ...vectors.submission.plaintext, form: { ...vectors.submission.plaintext.form, title: 'abc' } };
    const ct = seal(pad(new TextEncoder().encode(JSON.stringify(plaintext)), 24_576), officePublic);
    const body = toBase64(
      buildEnvelope({ kind: KIND_SUBMISSION, officePublic, signerSeed: workerSeed, receivedAt: RECEIVED_AT, meta: vectors.submission.meta as EnvelopeMeta, ct }),
    );
    spool.writeAtomic(spool.inbox, 'inv', JSON.stringify({ v: 1, queue: 'forms', msg_id: 'inv', lease_id: 'l', attempts: 1, timestamp_ms: 0, body_b64: body }));
    let seen: Record<string, unknown> | null = null;
    const res = await runProcess(spool, {
      signers,
      officeKeys,
      submit: async (p) => {
        seen = p;
        return 'rejected_validation';
      },
      now,
    });
    expect(res.rejected).toBe(1);
    expect(seen).toMatchObject({ invalid: 'title' });
  });
});

describe('config: plik kluczy formularza', () => {
  it('format linii i weryfikacja kid', () => {
    const a = x25519RandomSecret();
    const b = x25519RandomSecret();
    const keys = parseFormKeys(`${formatFormKeyLine(a)}\n# poprzedni\n${formatFormKeyLine(b)}\n`);
    expect([...keys.keys()].length).toBe(2);
    const [kid] = formatFormKeyLine(a).split(' ');
    expect(() => parseFormKeys(`${kid} ${formatFormKeyLine(b).split(' ')[1]}`)).toThrow(ConfigError);
    expect(() => parseFormKeys('')).toThrow(ConfigError);
  });
});

describe('HttpClient', () => {
  it('odrzuca http:// poza pętlą zwrotną', async () => {
    await expect(new HttpClient().request('GET', 'http://example.com/', {})).rejects.toThrow(/niedozwolony/);
  });
});

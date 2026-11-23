// legatto-intake process (R9): proces z kluczem formularza i bazą, BEZ sieci zewnętrznej.
// Dla każdej koperty z inbox/: rozbiór → podpis Workera (allowlista signers.d) → wiek →
// deszyfracja (klucze biura) → schemat → intake.submit_public_case (rola legatto_intake) →
// decyzja w acks/ → usunięcie z inbox/. Ack dopiero po zapisie w bazie (commit funkcji) albo
// po kwarantannie. Błąd bazy = retry (wiadomość wróci z kolejki).

import {
  EnvelopeRejected,
  fromBase64,
  MAX_ENVELOPE_AGE_MS,
  openEnvelope,
  parseEnvelope,
  verifyEnvelopeSignature,
} from '../../packages/public-submission/src/index';
import { errorSummary } from '../../api/_lib/log-safe';
import type { AckOutcome, AckRecord, InboxMessage, Spool } from './spool';

/** Wywołanie intake.submit_public_case(p jsonb) - wynik funkcji SQL albo wyjątek (błąd bazy). */
export type SubmitFn = (payload: Record<string, unknown>) => Promise<string>;

export interface ProcessOptions {
  signers: ReadonlyMap<string, Uint8Array>;
  officeKeys: ReadonlyMap<string, Uint8Array>;
  submit: SubmitFn;
  now?: () => number;
}

export interface ProcessSummary {
  ok: boolean;
  processed: number;
  inserted: number;
  duplicate: number;
  rejected: number;
  quarantined: number;
  retry: number;
  selftest: { marker: string; outcome: AckOutcome }[];
}

const SQL_OUTCOMES: readonly AckOutcome[] = ['inserted', 'duplicate', 'rejected_validation', 'rejected_ratelimit', 'selftest'];

type QuarantineReason = EnvelopeRejected['reason'] | 'expired' | 'bad_record';

function quarantine(spool: Spool, msg: InboxMessage | null, msgId: string, raw: Uint8Array | null, reason: QuarantineReason, now: number): void {
  if (raw) spool.writeAtomic(spool.quarantine, msgId, raw, '.bin');
  spool.writeAtomic(
    spool.quarantine,
    msgId,
    JSON.stringify({ v: 1, msg_id: msgId, queue: msg?.queue ?? null, reason, at: new Date(now).toISOString() }),
  );
}

export async function runProcess(spool: Spool, options: ProcessOptions): Promise<ProcessSummary> {
  const now = options.now ?? Date.now;
  const summary: ProcessSummary = {
    ok: true,
    processed: 0,
    inserted: 0,
    duplicate: 0,
    rejected: 0,
    quarantined: 0,
    retry: 0,
    selftest: [],
  };

  for (const msgId of spool.list(spool.inbox)) {
    let msg: InboxMessage | null = null;
    let raw: Uint8Array | null = null;
    let action: AckRecord['action'] = 'ack';
    let outcome: AckRecord['outcome'];
    try {
      msg = spool.readJson<InboxMessage>(spool.inbox, msgId);
      if (msg.v !== 1 || msg.msg_id !== msgId || typeof msg.lease_id !== 'string' || typeof msg.body_b64 !== 'string') {
        throw new EnvelopeRejected('bad_size', 'rekord inbox');
      }
      raw = fromBase64(msg.body_b64);
      const parts = parseEnvelope(raw);
      verifyEnvelopeSignature(parts, options.signers);
      if (now() - parts.receivedAt > MAX_ENVELOPE_AGE_MS) {
        quarantine(spool, msg, msgId, raw, 'expired', now());
        outcome = 'quarantined';
      } else {
        const opened = openEnvelope(parts, options.officeKeys);
        const payload: Record<string, unknown> = {
          id: opened.frame.id,
          kind: opened.frame.kind,
          ref: opened.ref,
          received_at: new Date(parts.receivedAt).toISOString(),
          meta: { ip_hash: opened.meta.ip_hash, ua: opened.meta.ua },
        };
        if (opened.frame.kind === 'selftest') {
          payload.marker = opened.frame.marker;
          payload.mode = opened.frame.mode;
        } else {
          payload.form = opened.form ?? opened.frame.form;
          if (opened.invalid) payload.invalid = opened.invalid;
        }
        try {
          const result = await options.submit(payload);
          if (!SQL_OUTCOMES.includes(result as AckOutcome)) throw new Error(`nieoczekiwany wynik SQL: ${result}`);
          outcome = result as AckOutcome;
        } catch (err) {
          action = 'retry';
          outcome = 'error';
          // Komunikat pg potrafi cytować wartości zgłoszenia - tylko klasa i SQLSTATE.
          process.stderr.write(`process: błąd bazy ${JSON.stringify(errorSummary(err))}\n`);
        }
        if (opened.frame.kind === 'selftest' && outcome !== 'error') {
          summary.selftest.push({ marker: opened.frame.marker, outcome });
        }
      }
    } catch (err) {
      if (!(err instanceof EnvelopeRejected) && !(err instanceof SyntaxError) && !(err instanceof Error && /base64/.test(err.message))) {
        throw err;
      }
      const reason: QuarantineReason = err instanceof EnvelopeRejected ? err.reason : 'bad_record';
      quarantine(spool, msg, msgId, raw, reason, now());
      outcome = 'quarantined';
      if (!msg || typeof msg.lease_id !== 'string') {
        // Rekord bez dzierżawy nie trafi do kolejki - zostaje tylko kwarantanna.
        spool.remove(spool.inbox, msgId);
        summary.quarantined += 1;
        summary.processed += 1;
        continue;
      }
    }

    const ack: AckRecord = { v: 1, queue: msg.queue, msg_id: msgId, lease_id: msg.lease_id, action, outcome };
    spool.writeAtomic(spool.acks, msgId, JSON.stringify(ack));
    spool.remove(spool.inbox, msgId);
    summary.processed += 1;
    if (outcome === 'inserted') summary.inserted += 1;
    else if (outcome === 'duplicate') summary.duplicate += 1;
    else if (outcome === 'rejected_validation' || outcome === 'rejected_ratelimit') summary.rejected += 1;
    else if (outcome === 'quarantined') summary.quarantined += 1;
    else if (outcome === 'error') {
      summary.retry += 1;
      summary.ok = false;
    }
  }
  return summary;
}

// legatto-intake - CLI kontenera intake w obrazie `app` (`node /app/server/intake.mjs <komenda>`).
// Uruchamia je narzędzie hosta `legatto-intake` (legatto-infra, tor publicsite) w osobnych
// kontenerach (R9): fetch (sieć + token kolejki), process (klucz + baza, bez sieci zewnętrznej),
// keygen (bez sieci), selftest (sieć). Kontrakt: legatto-infra, interfejs app↔publicsite §4.
//
// Wynik: jeden obiekt JSON na stdout; komunikaty na stderr; nigdy sekrety.
// Kody wyjścia: 0 OK, 1 błąd, 2 błędne argumenty, 4 brak konfiguracji, 10 część wiadomości
// z błędem przejściowym (retry / ack do ponowienia).

import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  buildSelftestRequest,
  encryptPlaintext,
  fromBase64,
  keyId,
  parseFormKey,
  toBase64,
  x25519PublicKey,
  x25519RandomSecret,
} from '../../packages/public-submission/src/index';
import { errorSummary } from '../../api/_lib/log-safe';
import { ConfigError, DEFAULTS, env, formatFormKeyLine, loadSigners, parseFormKeys, readSecretFile } from './config';
import { connectIntakeDb } from './db';
import { runFetch } from './fetch';
import { HttpClient } from './http';
import { runProcess } from './process';
import { QueueClient } from './queue';
import { Spool } from './spool';

const USAGE = `Użycie: intake.mjs <fetch|process|keygen|selftest> [opcje]
  fetch                                   ack z acks/, pull do inbox/ (env LEGATTO_CF_*)
  process                                 inbox/ -> baza -> acks/ (klucz, signers.d, PG*)
  keygen --out FILE [--previous FILE]     nowy klucz X25519 formularza (stdout: kid, klucz publiczny)
  selftest --site https://HOST --marker HEX32 [--mode ping|verify]`;

class UsageError extends Error {}

function print(result: unknown): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function cmdFetch(): Promise<number> {
  const caFile = env('LEGATTO_CF_CA_FILE', DEFAULTS.caFile);
  const http = new HttpClient({ ca: readSecretFile(caFile) });
  const queue = new QueueClient(
    http,
    env('LEGATTO_CF_API_BASE', DEFAULTS.apiBase),
    env('LEGATTO_CF_ACCOUNT_ID'),
    readSecretFile(env('LEGATTO_CF_QUEUES_TOKEN_FILE', DEFAULTS.queuesTokenFile)),
  );
  const dlq = process.env.LEGATTO_CF_DLQ_ID?.trim();
  const summary = await runFetch(new Spool(env('LEGATTO_INTAKE_DIR', DEFAULTS.intakeDir)), queue, {
    queues: { forms: env('LEGATTO_CF_QUEUE_ID'), ...(dlq ? { dlq } : {}) },
    batchSize: 50,
    visibilityTimeoutMs: 15 * 60_000,
    retryDelaySeconds: 300,
    maxBatches: 20,
  });
  print(summary);
  return summary.ok ? 0 : 10;
}

async function cmdProcess(): Promise<number> {
  const officeKeys = parseFormKeys(readSecretFile(env('LEGATTO_FORM_KEY_FILE', DEFAULTS.formKeyFile)));
  const signers = loadSigners(env('LEGATTO_SIGNERS_DIR', DEFAULTS.signersDir));
  const db = await connectIntakeDb();
  try {
    const summary = await runProcess(new Spool(env('LEGATTO_INTAKE_DIR', DEFAULTS.intakeDir)), {
      signers,
      officeKeys,
      submit: db.submit,
    });
    print(summary);
    return summary.ok ? 0 : 10;
  } finally {
    await db.close();
    for (const key of officeKeys.values()) key.fill(0);
  }
}

function cmdKeygen(args: string[]): number {
  const { values } = parseArgs({ args, options: { out: { type: 'string' }, previous: { type: 'string' } }, strict: true });
  if (!values.out) throw new UsageError('keygen: wymagane --out FILE');
  const secret = x25519RandomSecret();
  const lines = [formatFormKeyLine(secret)];
  if (values.previous) {
    const previous = parseFormKeys(readSecretFile(values.previous));
    for (const old of previous.values()) {
      const line = formatFormKeyLine(old);
      if (!lines.includes(line)) lines.push(line);
    }
  }
  // 'wx': nigdy nie nadpisujemy istniejącego pliku klucza.
  const fd = openSync(values.out, 'wx', 0o600);
  try {
    writeSync(fd, `${lines.join('\n')}\n`);
  } finally {
    closeSync(fd);
  }
  const publicKey = x25519PublicKey(secret);
  secret.fill(0);
  print({ kid: keyId(publicKey), x25519: toBase64(publicKey) });
  return 0;
}

async function cmdSelftest(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { site: { type: 'string' }, marker: { type: 'string' }, mode: { type: 'string', default: 'ping' } },
    strict: true,
  });
  if (!values.site || !values.marker) throw new UsageError('selftest: wymagane --site i --marker');
  const site = new URL(values.site);
  if (site.protocol !== 'https:' || site.pathname !== '/' || site.search || site.hash) {
    throw new UsageError('selftest: --site musi być originem https://host');
  }
  if (!/^[0-9a-f]{32}$/.test(values.marker)) throw new UsageError('selftest: --marker = 32 znaki hex');
  if (values.mode !== 'ping' && values.mode !== 'verify') throw new UsageError('selftest: --mode ping|verify');

  const formKey = parseFormKey(JSON.parse(readFileSync(env('LEGATTO_FORM_PUB_FILE'), 'utf8')) as unknown);
  const seed = fromBase64(readSecretFile(env('LEGATTO_SELFTEST_KEY_FILE', DEFAULTS.selftestKeyFile)));
  if (seed.length !== 32) throw new ConfigError('klucz selftest: oczekiwano 32 B (base64)');

  const ts = new Date().toISOString();
  const ct = encryptPlaintext(
    { v: 1, id: randomUUID(), ts, kind: 'selftest', site: site.host, form: null, marker: values.marker, mode: values.mode },
    formKey.publicKey,
  );
  const request = buildSelftestRequest(ct, formKey.kid, seed, ts, randomBytes(16).toString('hex'));
  seed.fill(0);
  const res = await new HttpClient().request(
    'POST',
    new URL('/api/selftest', site).toString(),
    { 'Content-Type': 'application/json', Accept: 'application/json' },
    JSON.stringify(request),
  );
  let ref: string | null = null;
  try {
    const body = JSON.parse(res.body.toString('utf8')) as { ref?: unknown };
    ref = typeof body.ref === 'string' ? body.ref : null;
  } catch {
    ref = null;
  }
  print({ ok: res.status === 202, status: res.status, ref });
  return res.status === 202 ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'fetch':
        return await cmdFetch();
      case 'process':
        return await cmdProcess();
      case 'keygen':
        return cmdKeygen(rest);
      case 'selftest':
        return await cmdSelftest(rest);
      default:
        throw new UsageError(command ? `nieznana komenda: ${command}` : 'brak komendy');
    }
  } catch (err) {
    if (err instanceof UsageError || (err instanceof TypeError && 'code' in err && String(err.code).startsWith('ERR_PARSE_ARGS'))) {
      process.stderr.write(`${err.message}\n${USAGE}\n`);
      print({ ok: false, error: 'usage' });
      return 2;
    }
    if (err instanceof ConfigError) {
      process.stderr.write(`konfiguracja: ${err.message}\n`);
      print({ ok: false, error: 'config' });
      return 4;
    }
    process.stderr.write(`błąd: ${JSON.stringify(errorSummary(err))}\n`);
    print({ ok: false, error: 'internal' });
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));

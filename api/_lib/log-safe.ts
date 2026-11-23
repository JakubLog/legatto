/**
 * Bezpieczny opis bledu do logow produkcyjnych (Vercel, journald na VPS, Uptime Kuma).
 *
 * Logi nie moga zawierac danych osobowych, a tresc bledu czesto je niesie: PostgREST/Postgres
 * wkladaja wartosci wierszy w `message`/`details`/`hint` ("Key (email)=(jan@x.pl) already exists"),
 * bledy fetch - adres z tokenami w query, dostawcy (Resend, GetResponse, Anthropic) - fragmenty
 * wysylanej tresci. Dlatego do logu trafia tylko nazwa klasy, kod (Postgres/PostgREST/Auth/Node/
 * dostawcy) i status HTTP - nigdy message, details, hint, URL ani body.
 *
 * Odpowiednik dla Edge Functions (osobny runtime Deno): supabase/functions/_shared/log-safe.ts.
 */

export interface ErrorSummary {
  name: string;
  code?: string;
  status?: number;
  /** Operacja z DbError (stala z kodu, nie dane). */
  op?: string;
}

const NAME_RE = /^[A-Za-z_$][\w$]{0,63}$/;
const CODE_RE = /^[\w.-]{1,64}$/;

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function safeCode(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return typeof value === 'string' && CODE_RE.test(value) ? value : undefined;
}

function safeStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

/**
 * Blad Supabase (PostgREST, Auth, Storage) przekazany dalej bez tresci: message to tylko
 * operacja i kod, wiec moze trafic do logu handlera. Zamiast `throw new Error(error.message)`.
 */
export class DbError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly op?: string;

  constructor(error: unknown, op?: string) {
    const code = safeCode(field(error, 'code'));
    const status = safeStatus(field(error, 'status'));
    super(`${op ? `${op}: ` : ''}${code ?? (status ? `HTTP ${status}` : 'błąd bazy')}`);
    this.name = 'DbError';
    this.code = code;
    this.status = status;
    this.op = op;
  }
}

export function errorSummary(err: unknown): ErrorSummary {
  const rawName = err instanceof Error ? err.name : field(err, 'name');
  const summary: ErrorSummary = {
    name: typeof rawName === 'string' && NAME_RE.test(rawName) ? rawName : err === null ? 'null' : typeof err,
  };
  // fetch() rzuca TypeError('fetch failed') z kodem sieci (ECONNREFUSED, UND_ERR_*) w cause.
  const code = safeCode(field(err, 'code')) ?? safeCode(field(field(err, 'cause'), 'code'));
  if (code) summary.code = code;
  const status = safeStatus(field(err, 'status')) ?? safeStatus(field(err, 'statusCode'));
  if (status) summary.status = status;
  if (err instanceof DbError && err.op) summary.op = err.op;
  return summary;
}

/**
 * Bezpieczny opis bledu do logow Edge Functions (Supabase Logs) - odpowiednik
 * api/_lib/log-safe.ts dla runtime Deno.
 *
 * Logi nie moga zawierac danych osobowych, a tresc bledu czesto je niesie: PostgREST/Postgres
 * wkladaja wartosci wierszy w `message`/`details`/`hint` ("Key (email)=(jan@x.pl) already exists"),
 * bledy fetch - adres z tokenami w query, GetResponse - dane kontaktu w body. Dlatego do logu
 * trafia tylko nazwa klasy, kod (Postgres/PostgREST/Auth/dostawcy) i status HTTP - nigdy message,
 * details, hint, URL ani body.
 */

export interface ErrorSummary {
  name: string;
  code?: string;
  status?: number;
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

export function errorSummary(err: unknown): ErrorSummary {
  const rawName = err instanceof Error ? err.name : field(err, 'name');
  const summary: ErrorSummary = {
    name: typeof rawName === 'string' && NAME_RE.test(rawName) ? rawName : err === null ? 'null' : typeof err,
  };
  // fetch() rzuca TypeError z kodem sieci w cause.
  const code = safeCode(field(err, 'code')) ?? safeCode(field(field(err, 'cause'), 'code'));
  if (code) summary.code = code;
  const status = safeStatus(field(err, 'status')) ?? safeStatus(field(err, 'statusCode'));
  if (status) summary.status = status;
  return summary;
}

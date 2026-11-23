// vercel.json jako jedyne źródło reguł routingu także na VPS: rewrites (semantyka path-to-regexp 6
// jak w @vercel/routing-utils: strict, sensitive, segmenty nazwane i `$n`), headers, limity czasu
// funkcji (functions.*.maxDuration) i crony (eksport do manifestu wydania).

import fs from 'node:fs';
import { pathToRegexp, type Key } from 'path-to-regexp';

export interface VercelJson {
  functions?: Record<string, { maxDuration?: number }>;
  crons?: { path: string; schedule: string }[];
  headers?: { source: string; headers: { key: string; value: string }[] }[];
  rewrites?: { source: string; destination: string }[];
}

interface SourceMatcher {
  regex: RegExp;
  keys: Key[];
}

export interface HeaderRule {
  source: string;
  matcher: SourceMatcher;
  headers: [string, string][];
}

export interface RewriteRule {
  source: string;
  destination: string;
  matcher: SourceMatcher;
}

export interface CronJob {
  /** Nazwa jednostki (ostatni segment ścieżki), np. `sync-ics` → legatto-cron-sync-ics.timer. */
  name: string;
  path: string;
  schedule: string;
}

export interface CompiledVercelConfig {
  headers: HeaderRule[];
  rewrites: RewriteRule[];
  /** [glob, sekundy] w kolejności z vercel.json; pierwsze dopasowanie wygrywa. */
  maxDurations: [RegExp, number][];
  crons: CronJob[];
}

/** Domyślny limit funkcji bez wpisu w `functions` (Vercel, fluid compute). */
export const DEFAULT_MAX_DURATION_SECONDS = 300;

const CRON_PATH_RE = /^\/api\/cron\/([a-z0-9-]{1,60})$/;
const CRON_SCHEDULE_RE = /^[0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+$/;

function compileSource(source: string): SourceMatcher {
  const keys: Key[] = [];
  const regex = pathToRegexp(source, keys, { strict: true, sensitive: true, delimiter: '/' });
  return { regex, keys };
}

/** Glob z `functions` (np. `api/cron/*.ts`): `*` w obrębie segmentu, `**` przez segmenty. */
function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      out += '.*';
      i++;
    } else if (ch === '*') {
      out += '[^/]*';
    } else {
      out += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

export function compileVercelConfig(json: VercelJson): CompiledVercelConfig {
  const crons = (json.crons ?? []).map(({ path, schedule }) => {
    const name = CRON_PATH_RE.exec(path)?.[1];
    if (!name) throw new Error(`vercel.json: cron ${path} poza /api/cron/<nazwa>`);
    if (!CRON_SCHEDULE_RE.test(schedule)) throw new Error(`vercel.json: niepoprawny harmonogram ${schedule} (${path})`);
    return { name, path, schedule };
  });
  return {
    headers: (json.headers ?? []).map(({ source, headers }) => ({
      source,
      matcher: compileSource(source),
      headers: headers.map(({ key, value }) => [key, value] as [string, string]),
    })),
    rewrites: (json.rewrites ?? []).map(({ source, destination }) => ({
      source,
      destination,
      matcher: compileSource(source),
    })),
    maxDurations: Object.entries(json.functions ?? {}).map(([glob, { maxDuration }]) => [
      globToRegExp(glob),
      maxDuration ?? DEFAULT_MAX_DURATION_SECONDS,
    ]),
    crons,
  };
}

export function loadVercelConfig(file: string): CompiledVercelConfig {
  return compileVercelConfig(JSON.parse(fs.readFileSync(file, 'utf8')) as VercelJson);
}

/** Nagłówki z `headers` dla ścieżki żądania (przed rewrite), w kolejności reguł; późniejsza nadpisuje. */
export function headersFor(config: CompiledVercelConfig, pathname: string): [string, string][] {
  const out: [string, string][] = [];
  for (const rule of config.headers) {
    if (rule.matcher.regex.test(pathname)) out.push(...rule.headers);
  }
  return out;
}

/** Limit czasu funkcji (sekundy) dla pliku `api/...ts`. */
export function maxDurationFor(config: CompiledVercelConfig, file: string): number {
  for (const [glob, seconds] of config.maxDurations) {
    if (glob.test(file)) return seconds;
  }
  return DEFAULT_MAX_DURATION_SECONDS;
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface RewriteResult {
  /** Ścieżka docelowa (bez query). */
  pathname: string;
  /** Query z destination po podstawieniu segmentów i nieużyte segmenty nazwane. */
  query: URLSearchParams;
}

/**
 * Pierwsza pasująca reguła `rewrites` dla ścieżki (surowej, zakodowanej) albo null. Segmenty
 * `:nazwa` i `$n` w destination dostają wartości ze źródła; segmenty nazwane nieużyte w destination
 * trafiają do query (jak na Vercelu).
 */
export function applyRewrites(config: CompiledVercelConfig, pathname: string): RewriteResult | null {
  for (const rule of config.rewrites) {
    const m = rule.matcher.regex.exec(pathname);
    if (!m) continue;
    const named: Record<string, string> = {};
    rule.matcher.keys.forEach((key, index) => {
      const value = m[index + 1];
      if (typeof key.name === 'string' && value !== undefined) named[key.name] = decodeSegment(value);
    });
    const used = new Set<string>();
    let destination = rule.destination.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (whole, name: string) => {
      if (!(name in named)) return whole;
      used.add(name);
      return encodeURIComponent(named[name]);
    });
    destination = destination.replace(/\$(\d+)/g, (_whole, n: string) => m[Number(n)] ?? '');
    const url = new URL(destination, 'http://rewrite.invalid');
    // Wartość w query została zakodowana powyżej; URLSearchParams ją dekoduje.
    const query = new URLSearchParams(url.search);
    for (const [name, value] of Object.entries(named)) {
      if (!used.has(name)) query.set(name, value);
    }
    return { pathname: url.pathname, query };
  }
  return null;
}

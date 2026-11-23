// Strażnik zero-adres: strona posła (Cloudflare Pages) nie może zdradzić adresu serwera biura ani
// zależności od Supabase. Uruchamiany po każdym `build` (kod wyjścia 20) i niezależnie przez publishera.
// Sprawdza wszystkie pliki katalogu wynikowego oraz limity Pages (20 000 plików, 25 MiB na plik).

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const PAGES_MAX_FILES = 20_000;
export const PAGES_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Wzorce zawsze zakazane. `caseSensitive` - prefiks JWT „eyJ” (bez rozróżniania wielkości liter dałby fałszywe trafienia). */
const FIXED_PATTERNS: { pattern: string; caseSensitive: boolean }[] = [
  { pattern: '/rest/v1', caseSensitive: false },
  { pattern: '/storage/v1', caseSensitive: false },
  { pattern: '/functions/v1', caseSensitive: false },
  { pattern: 'supabase', caseSensitive: false },
  { pattern: 'eyJ', caseSensitive: true },
];

/** Pliki tekstowe - sprawdzane w całości; binarne (obrazy, fonty) bez krótkiego wzorca „eyJ”. */
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.txt', '.svg', '.xml', '.map', '.webmanifest', '']);

export interface GuardFinding {
  /** Ścieżka względem katalogu wynikowego (z `/`). */
  file: string;
  /** Co znaleziono (wzorzec, host z --deny-host albo naruszony limit). */
  issue: string;
}

export interface GuardResult {
  ok: boolean;
  files: number;
  bytes: number;
  findings: GuardFinding[];
}

/** Rozszerzenie ostatniego segmentu ścieżki (`_headers` -> ''). */
function extension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/') ? path.slice(dot).toLowerCase() : '';
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
}

/** Skanuje katalog wynikowy; `denyHosts` porównywane bez wielkości liter (host biura, IP serwera...). */
export function guardDist(dir: string, denyHosts: readonly string[]): GuardResult {
  const findings: GuardFinding[] = [];
  const hosts = denyHosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  const files: string[] = [];
  walk(dir, files);

  // Pages Functions / zaawansowany tryb Workera - strona ma być wyłącznie statyczna.
  for (const name of ['_worker.js', 'functions']) {
    try {
      lstatSync(join(dir, name));
      findings.push({ file: name, issue: name === 'functions' ? 'katalog functions/' : '_worker.js' });
    } catch {
      // brak - poprawnie
    }
  }
  if (files.length > PAGES_MAX_FILES) findings.push({ file: '.', issue: `ponad ${PAGES_MAX_FILES} plików (${files.length})` });

  let bytes = 0;
  for (const full of files) {
    const rel = relative(dir, full).split(sep).join('/');
    const content = readFileSync(full);
    bytes += content.length;
    if (content.length > PAGES_MAX_FILE_BYTES) findings.push({ file: rel, issue: `plik większy niż ${PAGES_MAX_FILE_BYTES} B` });

    // Nazwa pliku też jest częścią publikacji (URL).
    const text = `${rel}\n${content.toString('latin1')}`;
    const lower = text.toLowerCase();
    const isText = TEXT_EXTENSIONS.has(extension(rel));
    for (const { pattern, caseSensitive } of FIXED_PATTERNS) {
      if (caseSensitive && !isText) continue;
      const found = caseSensitive ? text.includes(pattern) : lower.includes(pattern.toLowerCase());
      if (found) findings.push({ file: rel, issue: pattern });
    }
    for (const host of hosts) {
      if (lower.includes(host)) findings.push({ file: rel, issue: `host ${host}` });
    }
  }
  return { ok: findings.length === 0, files: files.length, bytes, findings };
}

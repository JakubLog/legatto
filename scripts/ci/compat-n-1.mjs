#!/usr/bin/env node
// Zgodność schematu N z kodem N-1 (job compat-n-1, scripts/ci/compat-n-1.sh).
//
//   node scripts/ci/compat-n-1.mjs refs <katalog drzewa N-1>          → JSON obiektów używanych przez kod
//   node scripts/ci/compat-n-1.mjs compare <refs.json> <przed.tsv> <po.tsv>
//
// `refs`: tabele/widoki z `.from('x')`, funkcje RPC z `.rpc('f', { arg: … })` (nazwy argumentów,
// gdy obiekt argumentów jest literałem), kubełki Storage z `.storage.from('b')`; skanuje src/, api/,
// server/, supabase/functions/ (.ts/.tsx/.mjs, bez testów).
// `compare`: powierzchnia schematu (SURFACE_SQL w compat-n-1.sh) po migracjach N-1 i po migracjach N.
// Każdy element powierzchni używany przez kod N-1 (kolumny i uprawnienia anon/authenticated/
// service_role do tabeli, istnienie funkcji, użyte argumenty, EXECUTE, kubełek) musi przetrwać N.
// Kod wyjścia: 0 zgodne, 1 utracone elementy, 2 błędne argumenty.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCAN_DIRS = ['src', 'api', 'server', 'supabase/functions'];
const EXT_RE = /\.(ts|tsx|mjs)$/;
const SKIP_RE = /\.test\.(ts|tsx|mjs)$|\.d\.ts$/;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (EXT_RE.test(entry.name) && !SKIP_RE.test(entry.name)) yield full;
  }
}

/** Klucze literału obiektu `{ a: …, b, 'c': … }` na najwyższym poziomie (bez zagnieżdżeń). */
export function objectKeys(src) {
  const keys = [];
  let depth = 0;
  let token = '';
  let expectKey = true;
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      if (expectKey) token += c;
      continue;
    }
    if ((c === '"' || c === "'" || c === '`') && !expectKey) {
      quote = c;
      continue;
    }
    if ((c === '"' || c === "'") && expectKey) quote = c;
    if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    if (depth !== 0) continue;
    if (c === ',') {
      if (expectKey && /^[A-Za-z_$][\w$]*$/.test(token.trim())) keys.push(token.trim()); // skrót { a }
      token = '';
      expectKey = true;
      continue;
    }
    if (c === ':' && expectKey) {
      keys.push(token.trim().replace(/^['"]|['"]$/g, ''));
      expectKey = false;
      continue;
    }
    if (expectKey) token += c;
  }
  if (expectKey && /^[A-Za-z_$][\w$]*$/.test(token.trim())) keys.push(token.trim());
  return keys.filter((k) => /^[a-z_][a-z0-9_]*$/.test(k));
}

/** Zakres `{…}` zaczynający się w `src[start]` (z uwzględnieniem zagnieżdżeń i stringów). */
function braceBlock(src, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start + 1, i);
  }
  return null;
}

export function extractRefs(source, refs) {
  for (const m of source.matchAll(/\.storage\s*\.from\(\s*['"]([a-z0-9_-]+)['"]/g)) refs.buckets.add(m[1]);
  for (const m of source.matchAll(/\.from\(\s*['"]([a-z_][a-z0-9_]*)['"]\s*\)/g)) {
    const before = source.slice(Math.max(0, m.index - 40), m.index);
    if (!/\.storage\s*$/.test(before)) refs.tables.add(m[1]);
  }
  for (const m of source.matchAll(/\.rpc\(\s*['"]([a-z_][a-z0-9_]*)['"]\s*(,\s*)?/g)) {
    const args = refs.rpc.get(m[1]) ?? new Set();
    refs.rpc.set(m[1], args);
    const after = m.index + m[0].length;
    if (m[2] && source[after] === '{') {
      const body = braceBlock(source, after);
      if (body !== null) for (const k of objectKeys(body)) args.add(k);
    }
  }
}

export function scanTree(root) {
  const refs = { tables: new Set(), rpc: new Map(), buckets: new Set() };
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(root, dir))) extractRefs(fs.readFileSync(file, 'utf8'), refs);
  }
  return {
    tables: [...refs.tables].sort(),
    rpc: Object.fromEntries([...refs.rpc.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()])),
    buckets: [...refs.buckets].sort(),
  };
}

/** Linie powierzchni schematu (TSV) dotyczące obiektów używanych przez kod N-1. */
export function relevantSurface(refs, lines) {
  const tables = new Set(refs.tables);
  const buckets = new Set(refs.buckets);
  const rpc = new Map(Object.entries(refs.rpc).map(([name, args]) => [name, new Set(args)]));
  return lines.filter((line) => {
    const [kind, name, detail] = line.split('\t');
    if (kind === 'table' || kind === 'tgrant') return tables.has(name);
    if (kind === 'bucket') return buckets.has(name);
    if (kind === 'func' || kind === 'fexec') return rpc.has(name);
    if (kind === 'farg') return rpc.get(name)?.has(detail) ?? false;
    return false;
  });
}

/** Elementy używane przez N-1, które były po migracjach N-1, a nie ma ich po migracjach N. */
export function lostSurface(refs, before, after) {
  const kept = new Set(after);
  return relevantSurface(refs, before).filter((line) => !kept.has(line));
}

/** Obiekty używane przez kod N-1, których nie było już po migracjach N-1 (błąd skanera lub martwy kod). */
export function unresolvedRefs(refs, before) {
  const present = new Set(before.map((line) => line.split('\t').slice(0, 2).join('\t')));
  return [
    ...refs.tables.filter((t) => !present.has(`table\t${t}`)).map((t) => `tabela ${t}`),
    ...Object.keys(refs.rpc).filter((f) => !present.has(`func\t${f}`)).map((f) => `funkcja ${f}`),
    ...refs.buckets.filter((b) => !present.has(`bucket\t${b}`)).map((b) => `kubełek ${b}`),
  ];
}

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

function main([command, ...args]) {
  if (command === 'refs' && args.length === 1 && fs.existsSync(args[0])) {
    process.stdout.write(`${JSON.stringify(scanTree(path.resolve(args[0])), null, 2)}\n`);
    return 0;
  }
  if (command === 'compare' && args.length === 3) {
    const refs = JSON.parse(fs.readFileSync(args[0], 'utf8'));
    const before = readLines(args[1]);
    const after = readLines(args[2]);
    for (const ref of unresolvedRefs(refs, before)) {
      console.log(`compat-n-1: uwaga - kod N-1 odwołuje się do obiektu nieobecnego już w schemacie N-1: ${ref}`);
    }
    const lost = lostSurface(refs, before, after);
    const checked = relevantSurface(refs, before).length;
    if (lost.length) {
      for (const line of lost) console.error(`compat-n-1: utracone w N: ${line.replace(/\t/g, ' ')}`);
      console.error(`compat-n-1: FAIL (${lost.length} z ${checked} elementów używanych przez N-1)`);
      return 1;
    }
    console.log(
      `compat-n-1: OK (${checked} elementów schematu używanych przez N-1: ${refs.tables.length} tabel, ` +
        `${Object.keys(refs.rpc).length} funkcji RPC, ${refs.buckets.length} kubełków)`,
    );
    return 0;
  }
  console.error('użycie: compat-n-1.mjs refs <drzewo> | compare <refs.json> <przed.tsv> <po.tsv>');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

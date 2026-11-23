#!/usr/bin/env node
// Lint migracji supabase/migrations (wydania self-host: N-1 musi działać na schemacie N, expand/contract).
//
//   node scripts/lint-migrations.mjs [--previous-release <ref>] [--dir supabase/migrations]
//
// Reguły:
//  1. Nazwa `<14 cyfr>_<a-z0-9_>.sql`, wersje unikalne (jak migrator i `migrations.files` w manifeście).
//  2. Migracje z supabase/migrations.baseline.json (sprzed reguły) są niezmienne: ten sam sha256,
//     żadnej nie wolno usunąć. Nowe migracje mają wersję większą niż ostatnia z baseline.
//  3. Każda nowa migracja ma w początkowym bloku komentarzy nagłówek kompatybilności:
//       -- compat-n-1: safe       tylko zmiany addytywne (nowe tabele, kolumny nullable/z default, funkcje)
//       -- compat-n-1: expand     etap expand: nowa struktura obok starej, obie działają
//       -- compat-n-1: contract   etap contract: usuwa/zmienia to, czego N-1 już nie używa; wymaga
//       -- contract-after: vX.Y.Z wydania, od którego aplikacja nie używa usuwanej struktury
//  4. Operacje łamiące N-1 (DROP TABLE/COLUMN/VIEW/FUNCTION/TYPE/SCHEMA/…, RENAME, SET SCHEMA,
//     ALTER COLUMN … TYPE / SET NOT NULL / DROP DEFAULT, TRUNCATE) wolno tylko w `contract`.
//     Wyjątek: DROP FUNCTION/VIEW/TYPE obiektu tworzonego ponownie w tym samym pliku (zmiana definicji).
//     DROP POLICY/TRIGGER/INDEX/CONSTRAINT nie łamią N-1 i są dozwolone wszędzie.
//  5. `contract-after: T` wymaga, żeby tag T istniał i zawierał się w poprzednim wydaniu (N-1):
//     `git merge-base --is-ancestor T <previous>`. <previous> = --previous-release albo najnowszy tag
//     v* osiągalny z HEAD^ (tag na HEAD to wydanie N); bez poprzedniego wydania contract jest odrzucany.
//  Migracja contract czekająca, aż wydanie z nowym kodem stanie się N-1, leży w
//  supabase/migrations-contract/<nazwa>.sql (bez wersji; lint, migrator i release.json jej nie widzą).
//  Gdy contract-after zawiera się w N-1, przenosi się ją do supabase/migrations z nową wersją.
//
// Kod wyjścia: 0 OK, 1 naruszenia reguł, 2 błędne argumenty.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NAME_RE = /^([0-9]{14})_[a-z0-9_]{1,100}\.sql$/;
const HEADER_RE = /^--\s*compat-n-1:\s*(\S+)\s*$/;
const CONTRACT_AFTER_RE = /^--\s*contract-after:\s*(\S+)\s*$/;
const TAG_RE = /^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;
export const COMPAT_CLASSES = ['safe', 'expand', 'contract'];

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = path.join(REPO_ROOT, 'supabase', 'migrations.baseline.json');

/** Nagłówek z początkowego bloku komentarzy (do pierwszej linii z kodem SQL). */
export function parseHeader(sql) {
  const header = { compat: null, contractAfter: null, errors: [] };
  for (const raw of sql.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (!line.startsWith('--')) break;
    const compat = HEADER_RE.exec(line);
    if (compat) {
      if (header.compat) header.errors.push('nagłówek compat-n-1 podany więcej niż raz');
      header.compat = compat[1];
    }
    const after = CONTRACT_AFTER_RE.exec(line);
    if (after) header.contractAfter = after[1];
  }
  return header;
}

/** SQL bez komentarzy, literałów i treści w $tag$…$tag$ (ciała funkcji), znormalizowany. */
export function stripSql(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      out += ' ';
      continue;
    }
    if (c === "'") {
      // E'…' (escape string): odwrotny ukośnik poprzedza znak, także apostrof.
      const escapes = /[eE]/.test(sql[i - 1] ?? '') && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? '');
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (escapes && sql[i] === '\\') { i += 2; continue; }
        if (sql[i] === "'") break;
        i++;
      }
      i++;
      out += "''";
      continue;
    }
    if (c === '"') {
      const end = sql.indexOf('"', i + 1);
      const ident = end === -1 ? sql.slice(i) : sql.slice(i, end + 1);
      out += ident;
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (c === '$') {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const start = i + tag[0].length;
        const end = sql.indexOf(tag[0], start);
        // Blok DO wykonuje się w migracji - jego treść też podlega regułom; ciała funkcji nie.
        const isDo = /\bdo\s*$/i.test(sql.slice(Math.max(0, i - 8), i));
        out += isDo ? ` ; ${stripSql(sql.slice(start, end === -1 ? sql.length : end))} ; ` : ' $body$ ';
        i = end === -1 ? sql.length : end + tag[0].length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out.toLowerCase().replace(/\s+/g, ' ');
}

const IDENT = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)`;
const QNAME = String.raw`(${IDENT}(?:\.${IDENT})?)`;
const RECREATABLE = { function: 'function', procedure: 'procedure', view: 'view', type: 'type' };

function normName(name) {
  const parts = name.replace(/"/g, '').split('.');
  return parts.length === 1 ? `public.${parts[0]}` : parts.join('.');
}

const DROP_KINDS = 'table|materialized view|view|function|procedure|type|domain|schema|sequence|extension|aggregate|operator';
const NOT_COLUMN = 'constraint|default|not null|identity|expression|policy|trigger';

/** Lista operacji łamiących N-1 w pliku (puste = plik zgodny w trybie safe/expand). */
export function findBreakingOps(sql) {
  const statements = stripSql(sql).split(';').map((s) => s.trim()).filter(Boolean);
  const created = new Set();
  const createRe = new RegExp(String.raw`\bcreate (?:or replace )?(?:materialized )?(function|procedure|view|type) ${QNAME}`, 'g');
  for (const s of statements) {
    for (const m of s.matchAll(createRe)) created.add(`${m[1]}:${normName(m[2])}`);
  }
  const dropRe = new RegExp(String.raw`\bdrop (${DROP_KINDS}) (?:if exists )?${QNAME}`, 'g');
  const dropColumnRe = new RegExp(
    String.raw`\bdrop column\b|(?:\balter table (?:if exists )?(?:only )?\S+|,) drop (?:if exists )?(?!(?:${NOT_COLUMN})\b)[a-z_"]`,
  );
  const ops = [];
  for (const s of statements) {
    const short = s.length > 120 ? `${s.slice(0, 117)}...` : s;
    for (const m of s.matchAll(dropRe)) {
      const kind = m[1];
      const recreated = RECREATABLE[kind] && created.has(`${RECREATABLE[kind]}:${normName(m[2])}`);
      if (!recreated) ops.push(`DROP ${kind.toUpperCase()}: ${short}`);
    }
    if (/(?:^|\b(?:then|begin|else|loop) )truncate (?!on\b)/.test(s)) ops.push(`TRUNCATE: ${short}`);
    if (!/\balter\b/.test(s)) continue;
    if (/\brename\b/.test(s)) ops.push(`RENAME: ${short}`);
    if (/\bset schema\b/.test(s)) ops.push(`SET SCHEMA: ${short}`);
    if (dropColumnRe.test(s)) ops.push(`DROP COLUMN: ${short}`);
    if (/\balter column \S+ (?:set data )?type\b/.test(s)) ops.push(`ALTER COLUMN TYPE: ${short}`);
    if (/\balter column \S+ set not null\b/.test(s)) ops.push(`SET NOT NULL: ${short}`);
    if (/\balter column \S+ drop default\b/.test(s)) ops.push(`DROP DEFAULT: ${short}`);
  }
  return ops;
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function gitOk(args) {
  try {
    execFileSync('git', args, { cwd: REPO_ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Najnowszy tag wydania osiągalny z HEAD^ (N-1; tag na samym HEAD to wydanie N) albo null. */
export function latestReleaseTag() {
  try {
    return git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD^']) || null;
  } catch {
    return null;
  }
}

/**
 * Lint katalogu migracji. `files`: [{ name, sql }] posortowane po nazwie; `baseline`: { name: sha256 };
 * `previousRelease`: ref N-1 albo null; `isReleasedBy(tag, ref)`: tag zawiera się w ref.
 */
export function lintMigrations({ files, baseline, previousRelease, isReleasedBy }) {
  const errors = [];
  const seen = new Map();
  const baselineNames = Object.keys(baseline).sort();
  const lastBaseline = baselineNames.length ? baselineNames[baselineNames.length - 1].slice(0, 14) : '';
  const present = new Set(files.map((f) => f.name));
  for (const name of baselineNames) {
    if (!present.has(name)) errors.push(`${name}: migracja z baseline usunięta`);
  }
  for (const { name, sql } of files) {
    const m = NAME_RE.exec(name);
    if (!m) {
      errors.push(`${name}: niepoprawna nazwa (wymagane <14 cyfr>_<a-z0-9_>.sql)`);
      continue;
    }
    if (seen.has(m[1])) errors.push(`${name}: wersja ${m[1]} zdublowana z ${seen.get(m[1])}`);
    seen.set(m[1], name);
    if (name in baseline) {
      if (sha256(sql) !== baseline[name]) errors.push(`${name}: zmieniona migracja z baseline (sha256)`);
      continue;
    }
    if (m[1] <= lastBaseline) errors.push(`${name}: wersja nie większa niż ostatnia z baseline (${lastBaseline})`);
    const header = parseHeader(sql);
    for (const e of header.errors) errors.push(`${name}: ${e}`);
    if (!header.compat) {
      errors.push(`${name}: brak nagłówka "-- compat-n-1: safe|expand|contract" w początkowym bloku komentarzy`);
      continue;
    }
    if (!COMPAT_CLASSES.includes(header.compat)) {
      errors.push(`${name}: compat-n-1 "${header.compat}" spoza ${COMPAT_CLASSES.join('|')}`);
      continue;
    }
    const ops = findBreakingOps(sql);
    if (header.compat !== 'contract') {
      if (header.contractAfter) errors.push(`${name}: contract-after tylko przy compat-n-1: contract`);
      for (const op of ops) errors.push(`${name}: ${op} — dozwolone tylko w etapie contract`);
      continue;
    }
    if (!header.contractAfter || !TAG_RE.test(header.contractAfter)) {
      errors.push(`${name}: contract wymaga "-- contract-after: vX.Y.Z"`);
    } else if (!previousRelease) {
      errors.push(`${name}: contract bez poprzedniego wydania (brak tagu v* / --previous-release)`);
    } else if (!isReleasedBy(header.contractAfter, previousRelease)) {
      errors.push(`${name}: ${header.contractAfter} nie zawiera się w poprzednim wydaniu ${previousRelease} — N-1 może jeszcze używać usuwanej struktury`);
    }
    if (ops.length === 0) errors.push(`${name}: contract bez operacji łamiących N-1 — użyj safe/expand`);
  }
  return errors;
}

function main(argv) {
  let dir = path.join(REPO_ROOT, 'supabase', 'migrations');
  let previousRelease;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) dir = path.resolve(argv[++i]);
    else if (argv[i] === '--previous-release' && argv[i + 1]) previousRelease = argv[++i];
    else {
      console.error('użycie: lint-migrations.mjs [--previous-release <ref>] [--dir <katalog>]');
      return 2;
    }
  }
  if (previousRelease === undefined) previousRelease = latestReleaseTag();
  else if (!gitOk(['rev-parse', '--verify', '--quiet', `${previousRelease}^{commit}`])) {
    console.error(`lint-migrations: nieznany ref ${previousRelease}`);
    return 2;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).files;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }));
  const isReleasedBy = (tag, ref) =>
    gitOk(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]) && gitOk(['merge-base', '--is-ancestor', tag, ref]);
  const errors = lintMigrations({ files, baseline, previousRelease, isReleasedBy });
  const fresh = files.filter((f) => !(f.name in baseline)).length;
  if (errors.length) {
    for (const e of errors) console.error(`lint-migrations: ${e}`);
    console.error(`lint-migrations: FAIL (${errors.length} naruszeń, ${files.length} migracji)`);
    return 1;
  }
  console.log(
    `lint-migrations: OK (${files.length} migracji: ${files.length - fresh} z baseline, ${fresh} nowych; N-1 = ${previousRelease ?? 'brak'})`,
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

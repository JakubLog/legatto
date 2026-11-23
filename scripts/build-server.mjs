#!/usr/bin/env node
// Build procesów Node obrazu `app` (VPS): każdy wpis ENTRIES → build/<name>.mjs, jeden plik ESM
// z zależnościami (obraz nie ma node_modules). Wersja wydania (semver) z LEGATTO_VERSION albo
// package.json trafia do kodu jako __LEGATTO_VERSION__ (server/version.ts).
//
//   node scripts/build-server.mjs            # wszystkie wpisy
//
// Wpisy dopisują tory, które mają procesy w obrazie app (intake, generator strony).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'build');

const ENTRIES = [
  { name: 'index', entry: 'server/index.ts' },
  { name: 'healthcheck', entry: 'server/healthcheck.ts' },
  { name: 'first-posel', entry: 'server/first-posel.ts' },
  { name: 'intake', entry: 'server/intake/cli.ts' },
  { name: 'site', entry: 'site/cli.ts' },
];

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/;

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = process.env.LEGATTO_VERSION?.trim() || pkg.version;
if (!SEMVER_RE.test(version)) {
  console.error(`build-server: wersja "${version}" nie jest semver`);
  process.exit(2);
}

for (const { entry } of ENTRIES) {
  if (!fs.existsSync(path.join(ROOT, entry))) {
    console.error(`build-server: brak pliku ${entry}`);
    process.exit(2);
  }
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });

await build({
  absWorkingDir: ROOT,
  entryPoints: Object.fromEntries(ENTRIES.map(({ name, entry }) => [name, entry])),
  outdir: OUT_DIR,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  // Zależności CommonJS wołają require() wbudowanych modułów - w bundlu ESM potrzebny jest require.
  banner: { js: "import { createRequire as __legattoCreateRequire } from 'node:module'; const require = __legattoCreateRequire(import.meta.url);" },
  // pg-native: opcjonalny dodatek `pg` (natywny), nieużywany.
  external: ['pg-native'],
  define: { __LEGATTO_VERSION__: JSON.stringify(version) },
  legalComments: 'eof',
  logLevel: 'warning',
});

console.log(`build-server: ${ENTRIES.map((e) => `build/${e.name}.mjs`).join(', ')} (wersja ${version})`);

#!/usr/bin/env node
// Pakowanie rozszerzenia Claude Desktop „Legatto” do mcpb/dist/legatto.mcpb (archiwum ZIP, MCPB manifest 0.3).
// Bez narzędzi zewnętrznych: ZIP składany ręcznie (zlib deflate), deterministycznie - stała kolejność plików
// i stały znacznik czasu (SOURCE_DATE_EPOCH albo 2026-01-01), więc ta sama treść daje ten sam skrót SHA-256.
// Przed spakowaniem: walidacja manifestu (podzbiór schematu mcpb-manifest-v0.3) i kontrola, że kod serwera
// importuje wyłącznie wbudowane moduły Node (`node:*`) i własne pliki z paczki.
//
// Użycie: node mcpb/build.mjs

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const MCPB_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = dirname(MCPB_DIR);
const OUT_FILE = join(MCPB_DIR, 'dist', 'legatto.mcpb');

/** Pliki spoza katalogu server/: ścieżka w paczce -> plik źródłowy. */
const EXTRA_FILES = {
  'manifest.json': join(MCPB_DIR, 'manifest.json'),
  'icon.png': join(REPO_DIR, 'public', 'apple-touch-icon.png'),
  LICENSE: join(REPO_DIR, 'LICENSE'),
};

// --- walidacja manifestu (mcpb-manifest-v0.3) --------------------------------------------------

const TOP_LEVEL_KEYS = new Set([
  '$schema', 'manifest_version', 'name', 'display_name', 'version', 'description', 'long_description', 'author',
  'repository', 'homepage', 'documentation', 'support', 'icon', 'icons', 'screenshots', 'localization', 'server',
  'tools', 'tools_generated', 'prompts', 'prompts_generated', 'keywords', 'license', 'privacy_policies',
  'compatibility', 'user_config', '_meta',
]);
const USER_CONFIG_KEYS = new Set(['type', 'title', 'description', 'required', 'default', 'multiple', 'sensitive', 'min', 'max']);
const USER_CONFIG_TYPES = new Set(['string', 'number', 'boolean', 'directory', 'file']);
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** @param {any} manifest @param {Set<string>} files ścieżki w paczce */
function validateManifest(manifest, files) {
  const errors = [];
  const isString = (v) => typeof v === 'string' && v.length > 0;
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) throw new Error('manifest.json: oczekiwany obiekt');
  for (const key of Object.keys(manifest)) if (!TOP_LEVEL_KEYS.has(key)) errors.push(`nieznane pole: ${key}`);
  if (manifest.manifest_version !== '0.3') errors.push('manifest_version musi być "0.3"');
  if (!isString(manifest.name) || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.name)) errors.push('name: wymagane, [a-z0-9-]');
  if (!isString(manifest.version) || !SEMVER_RE.test(manifest.version)) errors.push('version: wymagana wersja semver');
  if (!isString(manifest.description)) errors.push('description: wymagane');
  const author = manifest.author;
  if (typeof author !== 'object' || author === null || !isString(author.name)) errors.push('author.name: wymagane');
  else for (const key of Object.keys(author)) if (!['name', 'email', 'url'].includes(key)) errors.push(`author: nieznane pole ${key}`);
  if (manifest.icon !== undefined && (!isString(manifest.icon) || !files.has(manifest.icon))) errors.push(`icon: brak pliku ${manifest.icon}`);

  const server = manifest.server;
  if (typeof server !== 'object' || server === null) {
    errors.push('server: wymagane');
  } else {
    for (const key of Object.keys(server)) if (!['type', 'entry_point', 'mcp_config'].includes(key)) errors.push(`server: nieznane pole ${key}`);
    if (server.type !== 'node') errors.push('server.type musi być "node"');
    if (!isString(server.entry_point) || !files.has(server.entry_point)) errors.push(`server.entry_point: brak pliku ${server.entry_point}`);
    const cfg = server.mcp_config;
    if (typeof cfg !== 'object' || cfg === null || !isString(cfg.command)) {
      errors.push('server.mcp_config.command: wymagane');
    } else {
      for (const key of Object.keys(cfg)) if (!['command', 'args', 'env', 'platform_overrides'].includes(key)) errors.push(`server.mcp_config: nieznane pole ${key}`);
      if (cfg.args !== undefined && !(Array.isArray(cfg.args) && cfg.args.every((a) => typeof a === 'string'))) errors.push('server.mcp_config.args: tablica napisów');
      if (cfg.env !== undefined && (typeof cfg.env !== 'object' || cfg.env === null || !Object.values(cfg.env).every((v) => typeof v === 'string'))) {
        errors.push('server.mcp_config.env: obiekt napisów');
      }
      const referenced = JSON.stringify([cfg.args ?? [], cfg.env ?? {}]).matchAll(/\$\{user_config\.([A-Za-z0-9_]+)\}/g);
      for (const [, key] of referenced) {
        if (!manifest.user_config || !Object.hasOwn(manifest.user_config, key)) errors.push(`mcp_config odwołuje się do nieznanego user_config.${key}`);
      }
      if (!(cfg.args ?? []).includes(`\${__dirname}/${server.entry_point}`)) errors.push('mcp_config.args musi uruchamiać entry_point (${__dirname}/…)');
    }
  }

  for (const [key, entry] of Object.entries(manifest.user_config ?? {})) {
    if (typeof entry !== 'object' || entry === null) {
      errors.push(`user_config.${key}: oczekiwany obiekt`);
      continue;
    }
    for (const field of Object.keys(entry)) if (!USER_CONFIG_KEYS.has(field)) errors.push(`user_config.${key}: nieznane pole ${field}`);
    if (!USER_CONFIG_TYPES.has(entry.type)) errors.push(`user_config.${key}.type: niepoprawny typ`);
    if (!isString(entry.title) || !isString(entry.description)) errors.push(`user_config.${key}: wymagane title i description`);
    if (entry.sensitive !== undefined && entry.type !== 'string') errors.push(`user_config.${key}: sensitive tylko dla string`);
  }

  const compat = manifest.compatibility;
  if (compat !== undefined) {
    for (const key of Object.keys(compat)) if (!['claude_desktop', 'platforms', 'runtimes'].includes(key)) errors.push(`compatibility: nieznane pole ${key}`);
    for (const p of compat.platforms ?? []) if (!['darwin', 'win32', 'linux'].includes(p)) errors.push(`compatibility.platforms: ${p}`);
    for (const r of Object.keys(compat.runtimes ?? {})) if (!['node', 'python'].includes(r)) errors.push(`compatibility.runtimes: ${r}`);
  }
  for (const flag of ['tools_generated', 'prompts_generated']) {
    if (manifest[flag] !== undefined && typeof manifest[flag] !== 'boolean') errors.push(`${flag}: boolean`);
  }
  if (errors.length > 0) throw new Error(`manifest.json niepoprawny:\n  - ${errors.join('\n  - ')}`);
}

// --- kod serwera: tylko node:* i pliki z paczki --------------------------------------------------

const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;(])import\s*\(?\s*['"]([^'"]+)['"]/g;

/** @param {Map<string, Buffer>} serverFiles ścieżka w paczce -> treść */
function checkImports(serverFiles) {
  const errors = [];
  for (const [path, content] of serverFiles) {
    for (const match of content.toString('utf8').matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2];
      if (spec.startsWith('node:')) continue;
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const target = posix.normalize(posix.join(posix.dirname(path), spec));
        if (!serverFiles.has(target)) errors.push(`${path}: import ${spec} spoza paczki`);
        continue;
      }
      errors.push(`${path}: niedozwolony import "${spec}" (tylko node:* i pliki paczki)`);
    }
  }
  if (errors.length > 0) throw new Error(`Kod serwera:\n  - ${errors.join('\n  - ')}`);
}

/** Pliki *.mjs z mcpb/server (bez testów), ścieżki w paczce z separatorem `/`. */
async function collectServerFiles() {
  const root = join(MCPB_DIR, 'server');
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs') || entry.name.includes('.test.')) continue;
    const abs = join(entry.parentPath ?? entry.path, entry.name);
    const inBundle = `server/${relative(root, abs).split(sep).join('/')}`;
    files.set(inBundle, await readFile(abs));
  }
  return files;
}

// --- ZIP -----------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Buffer} data */
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Data i czas w formacie DOS (czas lokalny ZIP traktujemy jako UTC). @param {Date} date */
function dosDateTime(date) {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
  };
}

/**
 * Archiwum ZIP (deflate, nazwy UTF-8, atrybuty Unix 0644).
 * @param {[string, Buffer][]} entries posortowane [ścieżka, treść]
 * @param {Date} mtime
 */
function createZip(entries, mtime) {
  const { date, time } = dosDateTime(mtime);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    const stored = compressed.length >= data.length;
    const payload = stored ? data : compressed;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // wersja potrzebna do rozpakowania
    local.writeUInt16LE(0x0800, 6); // nazwy w UTF-8
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // utworzone na Unix, wersja 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // komentarz
    central.writeUInt16LE(0, 34); // dysk
    central.writeUInt16LE(0, 36); // atrybuty wewnętrzne
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralDir, end]);
}

function buildTime() {
  const raw = process.env.SOURCE_DATE_EPOCH?.trim();
  if (raw && /^\d+$/.test(raw)) return new Date(Number(raw) * 1000);
  return new Date(Date.UTC(2026, 0, 1));
}

// --- main ----------------------------------------------------------------------------------------

async function main() {
  const serverFiles = await collectServerFiles();
  checkImports(serverFiles);

  /** @type {Map<string, Buffer>} */
  const files = new Map(serverFiles);
  for (const [inBundle, source] of Object.entries(EXTRA_FILES)) files.set(inBundle, await readFile(source));

  const manifestBuf = /** @type {Buffer} */ (files.get('manifest.json'));
  let manifest;
  try {
    manifest = JSON.parse(manifestBuf.toString('utf8'));
  } catch (err) {
    throw new Error(`manifest.json: niepoprawny JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  validateManifest(manifest, new Set(files.keys()));

  const icon = /** @type {Buffer} */ (files.get('icon.png'));
  if (!icon.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('icon.png nie jest plikiem PNG');
  }

  const entries = [...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const zip = createZip(entries, buildTime());
  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, zip);

  const sha256 = createHash('sha256').update(zip).digest('hex');
  process.stdout.write(
    `${relative(process.cwd(), OUT_FILE) || OUT_FILE}: ${manifest.name} ${manifest.version}, ` +
      `${entries.length} plików, ${zip.length} B\nsha256 ${sha256}\n`,
  );
  for (const [name, data] of entries) process.stdout.write(`  ${name} (${data.length} B)\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

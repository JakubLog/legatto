// Uruchomienie rozszerzenia tak jak robi to Claude Desktop (node server/index.mjs, JSON-RPC na stdio)
// oraz pakowanie node mcpb/build.mjs.

import { spawn, execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { TokenStore } from '../server/lib/token-store.mjs';
import { TOOLS, startFakeOffice } from './fake-office.mjs';

const MCPB_DIR = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = join(MCPB_DIR, 'server', 'index.mjs');

/** @type {(() => Promise<unknown>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** @param {Record<string, string>} env */
function startExtension(env) {
  const child = spawn(process.execPath, [ENTRY], {
    env: { PATH: process.env.PATH ?? '', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += c;
  });
  /** @type {any[]} */
  const received = [];
  /** @type {(() => void)[]} */
  const waiters = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    received.push(JSON.parse(line));
    for (const w of waiters.splice(0)) w();
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  cleanups.push(async () => {
    child.stdin.end();
    await exited;
  });
  return {
    stderr: () => stderr,
    /** @param {unknown} msg */
    send: (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`),
    /** Czeka na odpowiedź o danym id. */
    async response(id) {
      for (;;) {
        const found = received.find((m) => m.id === id);
        if (found) return found;
        await new Promise((resolve) => waiters.push(resolve));
      }
    },
    received,
    close: async () => {
      child.stdin.end();
      return exited;
    },
  };
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1.0.0' } },
};

describe('rozszerzenie na stdio', () => {
  it('token MCP: initialize → tools/list przez stdin/stdout, token nie pojawia się na stderr', async () => {
    const token = 'epm_stdio_static_token_123';
    const fake = await startFakeOffice({ transport: 'sse', sessions: true, staticToken: token });
    cleanups.push(fake.close);
    const ext = startExtension({ LEGATTO_OFFICE_URL: fake.origin, LEGATTO_MCP_TOKEN: token, LEGATTO_CLIENT_ID: '${user_config.client_id}' });

    ext.send(INITIALIZE);
    expect(await ext.response(1)).toMatchObject({ result: { serverInfo: { name: 'office-mcp' } } });
    ext.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    ext.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(await ext.response(2)).toEqual({ jsonrpc: '2.0', id: 2, result: { tools: TOOLS } });

    expect(await ext.close()).toBe(0);
    expect(ext.stderr()).toContain('uwierzytelnianie: token MCP');
    expect(ext.stderr()).not.toContain(token);
  });

  it('OAuth: używa tokenu zapisanego w katalogu danych', async () => {
    // Pełny przepływ logowania jest w proxy.test.mjs; tu token „wydany wcześniej” leży już w pliku.
    const token = 'epm_seeded_oauth_token_1';
    const fake2 = await startFakeOffice({ transport: 'json', staticToken: token });
    cleanups.push(fake2.close);
    const dir = await mkdtemp(join(tmpdir(), 'legatto-entry-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    await new TokenStore(dir, fake2.origin, fake2.state.clientId).save({
      v: 1,
      origin: fake2.origin,
      client_id: fake2.state.clientId,
      access_token: token,
      expires_at: Date.now() + 3_600_000,
      refresh_token: null,
      scope: 'mcp',
    });

    const ext = startExtension({
      LEGATTO_OFFICE_URL: fake2.origin,
      LEGATTO_CLIENT_ID: fake2.state.clientId,
      LEGATTO_CLIENT_SECRET: fake2.state.clientSecret,
      LEGATTO_DATA_DIR: dir,
    });
    ext.send(INITIALIZE);
    expect(await ext.response(1)).toMatchObject({ result: { protocolVersion: '2024-11-05' } });
    ext.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(await ext.response(2)).toMatchObject({ result: { tools: TOOLS } });
    expect(await ext.close()).toBe(0);
    expect(ext.stderr()).toContain('uwierzytelnianie: OAuth');
    expect(ext.stderr()).not.toContain(token);
    expect(ext.stderr()).not.toContain(fake2.state.clientSecret);
  });

  it('brak konfiguracji: każde żądanie dostaje polski komunikat zamiast awarii procesu', async () => {
    const ext = startExtension({ LEGATTO_OFFICE_URL: '${user_config.office_url}' });
    ext.send(INITIALIZE);
    const response = await ext.response(1);
    expect(response.error.message).toContain('Brak adresu biura');
    ext.send('nie-json');
    expect(await ext.close()).toBe(0);
  });
});

/** Minimalny czytnik ZIP (katalog centralny) do sprawdzenia paczki. @param {Buffer} zip */
function readZip(zip) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localName = zip.readUInt16LE(local + 26);
    const localExtra = zip.readUInt16LE(local + 28);
    const start = local + 30 + localName + localExtra;
    const data = zip.subarray(start, start + compressedSize);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    expect(files.get(name)?.length).toBe(size);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

describe('pakowanie', () => {
  it('node mcpb/build.mjs tworzy dist/legatto.mcpb z poprawnym manifestem i samym kodem serwera', async () => {
    const run = promisify(execFile);
    await run(process.execPath, [join(MCPB_DIR, 'build.mjs')], { env: { ...process.env, SOURCE_DATE_EPOCH: '' } });
    const zip = await readFile(join(MCPB_DIR, 'dist', 'legatto.mcpb'));
    const files = readZip(zip);

    const manifest = JSON.parse(/** @type {Buffer} */ (files.get('manifest.json')).toString('utf8'));
    expect(manifest).toEqual(JSON.parse(await readFile(join(MCPB_DIR, 'manifest.json'), 'utf8')));
    expect(manifest.manifest_version).toBe('0.3');
    expect(files.has(manifest.server.entry_point)).toBe(true);
    expect(files.get(manifest.icon)?.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect([...files.keys()].every((n) => n === 'manifest.json' || n === 'icon.png' || n === 'LICENSE' || /^server\/.+\.mjs$/.test(n))).toBe(true);
    expect([...files.keys()].some((n) => n.includes('test'))).toBe(false);

    // Deterministycznie: drugie pakowanie daje identyczne bajty.
    await run(process.execPath, [join(MCPB_DIR, 'build.mjs')]);
    expect((await readFile(join(MCPB_DIR, 'dist', 'legatto.mcpb'))).equals(zip)).toBe(true);
  });
});

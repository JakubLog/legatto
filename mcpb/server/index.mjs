#!/usr/bin/env node
// Rozszerzenie Claude Desktop „Legatto” (MCP Bundle): serwer MCP na stdio, który przekazuje
// wiadomości do serwera MCP portalu biura (`<adres biura>/api/mcp`, osiągalny tylko przez VPN biura).
// Tylko wbudowane moduły Node ≥ 20. Konfiguracja: zmienne środowiskowe z user_config manifestu.

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { OAuthSession, StaticTokenAuth } from './lib/auth.mjs';
import { readConfig } from './lib/config.mjs';
import { LegattoError, RPC_CODE } from './lib/errors.mjs';
import { McpProxy } from './lib/proxy.mjs';
import { TokenStore, defaultDataDir } from './lib/token-store.mjs';

const log = (/** @type {string} */ message) => {
  process.stderr.write(`[legatto] ${message}\n`);
};

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  log(`Wymagany Node.js 20 lub nowszy (jest ${process.versions.node}).`);
  process.exit(1);
}

function readVersion() {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const version = readVersion();

const send = (/** @type {unknown} */ message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

process.stdout.on('error', (err) => {
  // Klient zamknął stdout (EPIPE) - nie ma do kogo odpowiadać.
  if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EPIPE') process.exit(0);
  log(`Błąd zapisu na stdout: ${err.message}`);
});

/** @type {McpProxy} */
let proxy;
try {
  const config = readConfig(process.env);
  const auth =
    config.mode === 'token'
      ? new StaticTokenAuth(config.mcpToken)
      : new OAuthSession({
          config,
          store: new TokenStore(defaultDataDir(), config.origin, config.clientId, log),
          log,
        });
  proxy = new McpProxy({
    mcpUrl: config.mcpUrl,
    host: config.host,
    auth,
    send,
    log,
    userAgent: `legatto-mcpb/${version} node/${process.versions.node}`,
  });
  log(`Legatto ${version}: serwer biura ${config.origin}, uwierzytelnianie: ${config.mode === 'token' ? 'token MCP' : 'OAuth'}.`);
} catch (err) {
  const fatal = err instanceof LegattoError ? err : new LegattoError(String(err), { kind: 'config' });
  log(fatal.message);
  proxy = new McpProxy({ mcpUrl: '', host: '', auth: null, send, log, userAgent: '', fatal });
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  if (line.trim() === '') return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: RPC_CODE.PARSE_ERROR, message: 'Niepoprawny JSON od klienta MCP' } });
    return;
  }
  void proxy.handle(message);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await proxy.close();
  process.exit(0);
}

lines.on('close', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('unhandledRejection', (reason) => {
  log(`Nieobsłużony błąd: ${reason instanceof Error ? reason.message : String(reason)}`);
});

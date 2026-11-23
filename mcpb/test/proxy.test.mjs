// Przepływ proxy na atrapie serwera biura: initialize -> tools/list (JSON i SSE), OAuth z PKCE,
// 401 -> odświeżenie tokenu, wygasła sesja, serwer nieosiągalny, anulowanie.

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { OAuthSession, StaticTokenAuth } from '../server/lib/auth.mjs';
import { readConfig } from '../server/lib/config.mjs';
import { McpProxy } from '../server/lib/proxy.mjs';
import { TokenStore } from '../server/lib/token-store.mjs';
import { TOOLS, closedPort, startFakeOffice } from './fake-office.mjs';

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1.0.0' } },
};
const INITIALIZED = { jsonrpc: '2.0', method: 'notifications/initialized' };
const TOOLS_LIST = (id) => ({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });

/** @type {(() => Promise<unknown>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function office(options) {
  const fake = await startFakeOffice(options);
  cleanups.push(fake.close);
  return fake;
}

/** Przeglądarka-atrapa: przechodzi przez authorize (zgoda od razu) do lokalnego callbacku. */
function fakeBrowser() {
  /** @type {string[]} */
  const opened = [];
  /** @type {Promise<string>[]} */
  const pages = [];
  return {
    opened,
    pages,
    open: async (url) => {
      opened.push(url);
      pages.push(fetch(url).then((r) => r.text()));
    },
  };
}

/**
 * @param {object} options
 * @param {string} options.origin
 * @param {'oauth' | 'token'} options.mode
 * @param {string} [options.token]
 * @param {{ clientId: string, clientSecret: string }} [options.client]
 * @param {(url: string) => Promise<void>} [options.openBrowser]
 * @param {number} [options.loginWaitMs]
 */
async function makeProxy({ origin, mode, token, client, openBrowser, loginWaitMs }) {
  const sent = [];
  const logs = [];
  const log = (m) => logs.push(m);
  const env =
    mode === 'token'
      ? { LEGATTO_OFFICE_URL: origin, LEGATTO_MCP_TOKEN: token }
      : { LEGATTO_OFFICE_URL: origin, LEGATTO_CLIENT_ID: client?.clientId, LEGATTO_CLIENT_SECRET: client?.clientSecret };
  const config = readConfig(env);
  let store = null;
  let auth;
  if (mode === 'token') {
    auth = new StaticTokenAuth(config.mcpToken);
  } else {
    const dir = await mkdtemp(join(tmpdir(), 'legatto-proxy-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    store = new TokenStore(dir, config.origin, config.clientId, log);
    auth = new OAuthSession({ config, store, log, openBrowser, loginWaitMs });
  }
  const proxy = new McpProxy({
    mcpUrl: config.mcpUrl,
    host: config.host,
    auth,
    send: (m) => sent.push(m),
    log,
    userAgent: 'legatto-mcpb/test',
    timeoutMs: 5000,
  });
  cleanups.push(() => proxy.close());
  return { proxy, sent, logs, store };
}

describe('proxy stdio ↔ Streamable HTTP', () => {
  it('JSON: initialize → tools/list z tokenem MCP; odpowiedź serwera na powiadomienie nie trafia do klienta', async () => {
    const fake = await office({ transport: 'json', staticToken: 'epm_static_token_value' });
    const { proxy, sent } = await makeProxy({ origin: fake.origin, mode: 'token', token: 'epm_static_token_value' });

    await proxy.handle(INITIALIZE);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: 0, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'office-mcp' } } });

    await proxy.handle(INITIALIZED);
    expect(sent).toHaveLength(1);

    await proxy.handle(TOOLS_LIST(1));
    expect(sent[1]).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: TOOLS } });

    expect(fake.state.mcpRequests.map((r) => r.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
    expect(fake.state.mcpRequests[2].authorization).toBe(`Bearer ${'epm_static_token_value'}`);
    expect(fake.state.mcpRequests[2].protocol).toBe('2024-11-05');
  });

  it('SSE + Mcp-Session-Id: przekazuje powiadomienia serwera i odpowiedź złożoną z fragmentów', async () => {
    const fake = await office({ transport: 'sse', sessions: true, staticToken: 'epm_static_token_value' });
    const { proxy, sent } = await makeProxy({ origin: fake.origin, mode: 'token', token: 'epm_static_token_value' });

    await proxy.handle(INITIALIZE);
    await proxy.handle(INITIALIZED);
    await proxy.handle(TOOLS_LIST('a'));

    const responses = sent.filter((m) => 'id' in m);
    const notifications = sent.filter((m) => m.method === 'notifications/message');
    expect(responses).toEqual([
      expect.objectContaining({ id: 0, result: expect.objectContaining({ protocolVersion: '2024-11-05' }) }),
      { jsonrpc: '2.0', id: 'a', result: { tools: TOOLS } },
    ]);
    expect(notifications).toHaveLength(2);
    expect(fake.state.mcpRequests.map((r) => r.session)).toEqual([null, 'sess-1', 'sess-1']);
  });

  it('wygasła sesja (404) → ponowna inicjalizacja i powtórzenie żądania', async () => {
    const fake = await office({ transport: 'sse', sessions: true, staticToken: 'epm_static_token_value' });
    const { proxy, sent } = await makeProxy({ origin: fake.origin, mode: 'token', token: 'epm_static_token_value' });
    await proxy.handle(INITIALIZE);
    await proxy.handle(INITIALIZED);
    fake.state.expireSessions();

    await proxy.handle(TOOLS_LIST(5));
    expect(sent.filter((m) => 'id' in m).at(-1)).toEqual({ jsonrpc: '2.0', id: 5, result: { tools: TOOLS } });
    expect(sent.some((m) => typeof m.id === 'string' && m.id.startsWith('legatto-reinit'))).toBe(false);
    expect(fake.state.mcpRequests.map((r) => `${r.method}@${r.session}`)).toEqual([
      'initialize@null',
      'notifications/initialized@sess-1',
      'tools/list@sess-1',
      'initialize@null',
      'notifications/initialized@sess-2',
      'tools/list@sess-2',
    ]);
  });

  it('OAuth: logowanie w przeglądarce z PKCE, token w pliku 0600, bez tokenów w dzienniku', async () => {
    const fake = await office({ transport: 'json' });
    const browser = fakeBrowser();
    const { proxy, sent, logs, store } = await makeProxy({
      origin: fake.origin,
      mode: 'oauth',
      client: fake.state,
      openBrowser: browser.open,
    });

    await proxy.handle(INITIALIZE);
    await proxy.handle(INITIALIZED);
    await proxy.handle(TOOLS_LIST(1));

    expect(sent.map((m) => m.id)).toEqual([0, 1]);
    expect(sent[1]).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: TOOLS } });
    expect(browser.opened).toHaveLength(1);
    expect(await browser.pages[0]).toContain('Zalogowano');
    const authorize = new URL(browser.opened[0]);
    expect(authorize.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(fake.state.grants).toEqual(['authorization_code']);

    const saved = JSON.parse(await readFile(store.path, 'utf8'));
    expect(fake.state.issuedAccessTokens()).toContain(saved.access_token);
    if (process.platform !== 'win32') expect((await stat(store.path)).mode & 0o777).toBe(0o600);
    expect(logs.join('\n')).not.toContain(saved.access_token);
  });

  it('401 → odświeżenie tokenu refresh tokenem i powtórzenie żądania', async () => {
    const fake = await office({ transport: 'json', refreshTokens: true });
    const browser = fakeBrowser();
    const { proxy, sent, logs, store } = await makeProxy({
      origin: fake.origin,
      mode: 'oauth',
      client: fake.state,
      openBrowser: browser.open,
    });
    await proxy.handle(INITIALIZE);
    await proxy.handle(INITIALIZED);
    const before = JSON.parse(await readFile(store.path, 'utf8'));

    fake.state.revokeAccessTokens();
    await proxy.handle(TOOLS_LIST(2));

    expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 2, result: { tools: TOOLS } });
    expect(fake.state.unauthorizedResponses).toBe(1);
    expect(fake.state.grants).toEqual(['authorization_code', 'refresh_token']);
    expect(browser.opened).toHaveLength(1);
    const after = JSON.parse(await readFile(store.path, 'utf8'));
    expect(after.access_token).not.toBe(before.access_token);
    expect(after.refresh_token).not.toBe(before.refresh_token);
    const allLogs = logs.join('\n');
    for (const secret of [before.access_token, before.refresh_token, after.access_token, after.refresh_token]) {
      expect(allLogs).not.toContain(secret);
    }
  });

  it('401 bez refresh tokena → ponowne logowanie w przeglądarce', async () => {
    const fake = await office({ transport: 'json' });
    const browser = fakeBrowser();
    const { proxy, sent } = await makeProxy({ origin: fake.origin, mode: 'oauth', client: fake.state, openBrowser: browser.open });
    await proxy.handle(INITIALIZE);
    fake.state.revokeAccessTokens();
    await proxy.handle(TOOLS_LIST(3));
    expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 3, result: { tools: TOOLS } });
    expect(browser.opened).toHaveLength(2);
    expect(fake.state.grants).toEqual(['authorization_code', 'authorization_code']);
  });

  it('wygasły token z pliku jest odnawiany przed wysłaniem żądania (bez 401)', async () => {
    const fake = await office({ transport: 'json', refreshTokens: true, tokenTtl: 30 });
    const browser = fakeBrowser();
    const { proxy, sent } = await makeProxy({ origin: fake.origin, mode: 'oauth', client: fake.state, openBrowser: browser.open });
    await proxy.handle(INITIALIZE);
    // expires_in 30 s < margines 60 s: każdy kolejny token od razu traktowany jako wygasły.
    await proxy.handle(TOOLS_LIST(4));
    expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 4, result: { tools: TOOLS } });
    expect(fake.state.unauthorizedResponses).toBe(0);
    expect(fake.state.grants).toEqual(['authorization_code', 'refresh_token']);
  });

  it('logowanie dłuższe niż limit żądania: komunikat po polsku, logowanie kończy się w tle', async () => {
    const fake = await office({ transport: 'json' });
    /** @type {string[]} */
    const opened = [];
    const { proxy, sent } = await makeProxy({
      origin: fake.origin,
      mode: 'oauth',
      client: fake.state,
      openBrowser: async (url) => {
        opened.push(url);
      },
      loginWaitMs: 200,
    });

    await proxy.handle(INITIALIZE);
    expect(sent[0]).toMatchObject({ id: 0, error: { code: -32001, data: { legatto: 'login' } } });
    expect(sent[0].error.message).toContain('Zaloguj się do portalu biura');

    // Użytkownik kończy logowanie w przeglądarce po czasie.
    expect(await (await fetch(opened[0])).text()).toContain('Zalogowano');
    await new Promise((r) => setTimeout(r, 100));

    await proxy.handle({ ...INITIALIZE, id: 1 });
    expect(sent[1]).toMatchObject({ id: 1, result: { protocolVersion: '2024-11-05' } });
    expect(opened).toHaveLength(1);
  });

  it('token MCP odrzucony (401) → komunikat o nowym tokenie', async () => {
    const fake = await office({ transport: 'json' });
    const { proxy, sent } = await makeProxy({ origin: fake.origin, mode: 'token', token: 'epm_unknown_token_x' });
    await proxy.handle(INITIALIZE);
    expect(sent[0]).toMatchObject({ id: 0, error: { code: -32001 } });
    expect(sent[0].error.message).toContain('Tokeny MCP');
  });

  it('serwer nieosiągalny → błąd JSON-RPC z prośbą o włączenie VPN', async () => {
    const port = await closedPort();
    const { proxy, sent } = await makeProxy({ origin: `http://127.0.0.1:${port}`, mode: 'token', token: 'epm_static_token_value' });
    await proxy.handle(INITIALIZE);
    await proxy.handle(INITIALIZED);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: 0, error: { code: -32000, data: { legatto: 'offline' } } });
    expect(sent[0].error.message).toContain('Włącz VPN biura (Tailscale/Headscale)');
  });

  it('nazwa hosta nieznana poza tailnetem (brak MagicDNS) → komunikat o VPN', async () => {
    const { proxy, sent } = await makeProxy({ origin: 'https://app.legatto.invalid', mode: 'token', token: 'epm_static_token_value' });
    await proxy.handle(INITIALIZE);
    expect(sent[0]).toMatchObject({ id: 0, error: { data: { legatto: 'offline' } } });
    expect(sent[0].error.message).toContain('(app.legatto.invalid). Włącz VPN biura (Tailscale/Headscale)');
  });

  it('OAuth przy wyłączonym VPN: discovery nieosiągalne → komunikat o VPN, bez otwierania przeglądarki', async () => {
    const port = await closedPort();
    const browser = fakeBrowser();
    const { proxy, sent } = await makeProxy({
      origin: `http://127.0.0.1:${port}`,
      mode: 'oauth',
      client: { clientId: 'oc_x', clientSecret: 'sekret' },
      openBrowser: browser.open,
    });
    await proxy.handle(INITIALIZE);
    expect(sent[0].error.message).toContain('Włącz VPN biura');
    expect(browser.opened).toHaveLength(0);
  });

  it('MCP wyłączone na instancji (404 MCP_DISABLED) → czytelny komunikat', async () => {
    const fake = await office({ mcpDisabled: 'MCP_DISABLED' });
    const { proxy, sent } = await makeProxy({ origin: fake.origin, mode: 'token', token: 'epm_static_token_value' });
    await proxy.handle(INITIALIZE);
    expect(sent[0].error.message).toContain('Serwer MCP jest wyłączony na tej instancji.');
  });

  it('notifications/cancelled przerywa żądanie bez wysyłania odpowiedzi', async () => {
    const fake = await office({ transport: 'json', staticToken: 'epm_static_token_value' });
    const { proxy, sent } = await makeProxy({ origin: fake.origin, mode: 'token', token: 'epm_static_token_value' });
    await proxy.handle(INITIALIZE);
    const slow = proxy.handle({ jsonrpc: '2.0', id: 9, method: 'slow' });
    await new Promise((r) => setTimeout(r, 100));
    await proxy.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 9, reason: 'test' } });
    await slow;
    expect(sent.filter((m) => m.id === 9)).toEqual([]);
  });
});

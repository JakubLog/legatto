// Atrapa serwera biura do testów: discovery OAuth, authorize (zgoda udzielana od razu),
// token (authorization_code + PKCE S256, opcjonalnie refresh_token) i endpoint MCP
// w wariancie JSON (jak api/mcp.ts) albo Streamable HTTP z SSE i Mcp-Session-Id.

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

export const TOOLS = [
  { name: 'list_cases', description: 'Lista spraw', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_case', description: 'Szczegóły sprawy', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
];

/**
 * @param {object} [options]
 * @param {'json' | 'sse'} [options.transport]
 * @param {boolean} [options.sessions]        wydawaj i wymagaj Mcp-Session-Id
 * @param {boolean} [options.refreshTokens]   wydawaj refresh token i obsługuj grant refresh_token
 * @param {number} [options.tokenTtl]         expires_in [s]
 * @param {string} [options.mcpDisabled]      kod 404 (MCP_DISABLED) dla wszystkich endpointów
 * @param {string} [options.staticToken]      dodatkowy, zawsze ważny token MCP (epm_…)
 */
export async function startFakeOffice({
  transport = 'json',
  sessions = false,
  refreshTokens = false,
  tokenTtl = 3600,
  mcpDisabled = '',
  staticToken = '',
} = {}) {
  const clientId = 'oc_test_client';
  const clientSecret = 'ocs_test_secret_value';
  /** @type {Map<string, { challenge: string, redirectUri: string }>} */
  const codes = new Map();
  /** @type {Set<string>} */
  const accessTokens = new Set(staticToken ? [staticToken] : []);
  /** @type {Set<string>} */
  const refreshTokenSet = new Set();
  /** @type {Set<string>} */
  const activeSessions = new Set();
  let sessionCounter = 0;
  const state = {
    clientId,
    clientSecret,
    /** @type {{ method: string, id: unknown, authorization: string, session: string | null, protocol: string | null }[]} */
    mcpRequests: [],
    /** @type {string[]} */
    grants: [],
    /** @type {string[]} */
    authorizeRequests: [],
    unauthorizedResponses: 0,
    revokeAccessTokens() {
      accessTokens.clear();
      if (staticToken) accessTokens.add(staticToken);
    },
    expireSessions() {
      activeSessions.clear();
    },
    issuedAccessTokens: () => [...accessTokens],
  };

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      handle(req, res, Buffer.concat(chunks).toString('utf8')).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(err) }));
      });
    });
  });

  /** @param {import('node:http').ServerResponse} res */
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }).end(JSON.stringify(body));
  };

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {string} body */
  async function handle(req, res, body) {
    const url = new URL(req.url ?? '/', origin);
    if (mcpDisabled) {
      json(res, 404, { error: 'Serwer MCP jest wyłączony na tej instancji.', code: mcpDisabled });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      json(res, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/api/oauth/authorize`,
        token_endpoint: `${origin}/api/oauth/token`,
        response_types_supported: ['code'],
        grant_types_supported: refreshTokens ? ['authorization_code', 'refresh_token'] : ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        scopes_supported: ['mcp'],
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/oauth/authorize') {
      state.authorizeRequests.push(url.toString());
      const q = url.searchParams;
      const redirectUri = q.get('redirect_uri') ?? '';
      if (
        q.get('client_id') !== clientId ||
        q.get('response_type') !== 'code' ||
        q.get('code_challenge_method') !== 'S256' ||
        !/^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge') ?? '') ||
        q.get('scope') !== 'mcp' ||
        !q.get('state') ||
        !/^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(redirectUri)
      ) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('bad authorize request');
        return;
      }
      const code = `epc_${randomBytes(12).toString('base64url')}`;
      codes.set(code, { challenge: /** @type {string} */ (q.get('code_challenge')), redirectUri });
      const target = new URL(redirectUri);
      target.searchParams.set('code', code);
      target.searchParams.set('state', /** @type {string} */ (q.get('state')));
      res.writeHead(302, { Location: target.toString() }).end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/oauth/token') {
      const form = new URLSearchParams(body);
      if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) {
        json(res, 401, { error: 'invalid_client' });
        return;
      }
      const grant = form.get('grant_type') ?? '';
      state.grants.push(grant);
      if (grant === 'authorization_code') {
        const entry = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        if (
          !entry ||
          entry.redirectUri !== form.get('redirect_uri') ||
          createHash('sha256').update(verifier).digest('base64url') !== entry.challenge
        ) {
          json(res, 400, { error: 'invalid_grant' });
          return;
        }
        json(res, 200, issueTokens(), { 'Cache-Control': 'no-store' });
        return;
      }
      if (grant === 'refresh_token' && refreshTokens) {
        const refresh = form.get('refresh_token') ?? '';
        if (!refreshTokenSet.delete(refresh)) {
          json(res, 400, { error: 'invalid_grant' });
          return;
        }
        json(res, 200, issueTokens(), { 'Cache-Control': 'no-store' });
        return;
      }
      json(res, 400, { error: 'unsupported_grant_type' });
      return;
    }
    if (url.pathname === '/api/mcp' && req.method === 'POST') {
      await handleMcp(req, res, body);
      return;
    }
    if (url.pathname === '/api/mcp' && req.method === 'DELETE') {
      activeSessions.delete(String(req.headers['mcp-session-id'] ?? ''));
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404).end();
  }

  function issueTokens() {
    const access = `epm_${randomBytes(18).toString('base64url')}`;
    accessTokens.add(access);
    /** @type {Record<string, unknown>} */
    const out = { access_token: access, token_type: 'bearer', expires_in: tokenTtl, scope: 'mcp' };
    if (refreshTokens) {
      const refresh = `epr_${randomBytes(18).toString('base64url')}`;
      refreshTokenSet.add(refresh);
      out.refresh_token = refresh;
    }
    return out;
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {string} body */
  async function handleMcp(req, res, body) {
    const authorization = String(req.headers.authorization ?? '');
    const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] ?? '';
    const accept = String(req.headers.accept ?? '');
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
      json(res, 406, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Accept' } });
      return;
    }
    if (!accessTokens.has(token)) {
      state.unauthorizedResponses += 1;
      json(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Brak autoryzacji' } });
      return;
    }
    const msg = JSON.parse(body);
    const session = req.headers['mcp-session-id'] ? String(req.headers['mcp-session-id']) : null;
    state.mcpRequests.push({
      method: msg.method ?? '(response)',
      id: msg.id,
      authorization,
      session,
      protocol: req.headers['mcp-protocol-version'] ? String(req.headers['mcp-protocol-version']) : null,
    });

    /** @type {Record<string, string>} */
    const headers = {};
    if (sessions) {
      if (msg.method === 'initialize') {
        sessionCounter += 1;
        const id = `sess-${sessionCounter}`;
        activeSessions.add(id);
        headers['Mcp-Session-Id'] = id;
      } else if (!session || !activeSessions.has(session)) {
        json(res, session ? 404 : 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Sesja nieznana' } });
        return;
      }
    }

    if (msg.id === undefined) {
      // Powiadomienie: Streamable HTTP -> 202, serwer biura (api/mcp.ts) -> 200 {id:null}.
      if (transport === 'sse') res.writeHead(202, headers).end();
      else json(res, 200, { jsonrpc: '2.0', id: null, result: {} }, headers);
      return;
    }

    if (msg.method === 'slow') {
      // Odpowiada dopiero po zerwaniu połączenia przez klienta (test anulowania).
      res.writeHead(200, { 'Content-Type': 'text/event-stream', ...headers });
      res.write(': czekam\n\n');
      return;
    }

    let result;
    let error;
    switch (msg.method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: 'office-mcp', version: '1.1.0', title: 'Biuro testowe' },
          instructions: 'Instrukcje testowe',
        };
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'ping':
        result = {};
        break;
      default:
        error = { code: -32601, message: `Nieznana metoda: ${msg.method}` };
    }
    const response = error ? { jsonrpc: '2.0', id: msg.id, error } : { jsonrpc: '2.0', id: msg.id, result };

    if (transport === 'sse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...headers });
      res.write(': keep-alive\r\n\r\n');
      res.write(
        `event: message\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'start' } })}\r\n\r\n`,
      );
      // Odpowiedź w kilku fragmentach, z danymi w dwóch liniach `data:`.
      const text = JSON.stringify(response, null, 1).split('\n');
      const half = Math.ceil(text.length / 2);
      const event = `id: 7\r\ndata: ${text.slice(0, half).join('\ndata: ')}\r\ndata: ${text.slice(half).join('\ndata: ')}\r\n\r\n`;
      for (let i = 0; i < event.length; i += 17) {
        res.write(event.slice(i, i + 17));
        await new Promise((r) => setImmediate(r));
      }
      res.end();
      return;
    }
    json(res, 200, response, headers);
  }

  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  return {
    origin,
    state,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve(undefined));
      }),
  };
}

/** Port, na którym nic nie słucha (do testu „serwer nieosiągalny”). */
export async function closedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(() => resolve(undefined)));
  return port;
}

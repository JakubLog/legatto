// Klient OAuth 2.1 (Authorization Code + PKCE S256) serwera biura:
//   discovery  GET  <origin>/.well-known/oauth-authorization-server   (api/oauth/discovery.ts)
//   authorize  GET  <authorization_endpoint> -> strona zgody /oauth/consent (sesja portalu, 2FA)
//   callback   GET  http://127.0.0.1:<port>/callback?code&state      (lokalny serwer rozszerzenia)
//   token      POST <token_endpoint> (client_secret_post)               (api/oauth/token.ts)
// Refresh token: używany, gdy serwer go wyda i ogłosi grant `refresh_token`; dziś serwer wydaje
// token MCP ważny 30 dni bez refresh tokena - po wygaśnięciu rozszerzenie prosi o ponowne logowanie.

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import { LegattoError } from './errors.mjs';
import { httpRequest, parseJson, readText } from './http.mjs';
import { codeChallengeS256, createCodeVerifier, createState } from './pkce.mjs';

const DISCOVERY_PATH = '/.well-known/oauth-authorization-server';
export const OAUTH_SCOPE = 'mcp';

/**
 * @typedef {object} AuthServerMetadata
 * @property {string} issuer
 * @property {string} authorization_endpoint
 * @property {string} token_endpoint
 * @property {string[]} grant_types_supported
 */

/**
 * Pobiera i weryfikuje metadane serwera autoryzacji (RFC 8414). Endpointy muszą leżeć pod adresem
 * biura - sekret klienta nie może trafić na inny host.
 * @param {{ origin: string, host: string }} config
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<AuthServerMetadata>}
 */
export async function discoverAuthServer(config, fetchImpl) {
  const response = await httpRequest(
    `${config.origin}${DISCOVERY_PATH}`,
    { method: 'GET', headers: { Accept: 'application/json' } },
    { host: config.host, fetchImpl, timeoutMs: 30_000 },
  );
  const body = parseJson(await readText(response, 64 * 1024));
  if (response.status === 404 && body && (body.code === 'MCP_DISABLED' || body.code === 'AI_DISABLED')) {
    throw new LegattoError(disabledMessage(body), { kind: 'server' });
  }
  if (!response.ok || !body || typeof body !== 'object') {
    throw new LegattoError(
      `Serwer biura (${config.host}) nie udostępnia logowania OAuth (HTTP ${response.status}). Sprawdź adres biura.`,
      { kind: 'server' },
    );
  }
  const { issuer, authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint } = body;
  if (typeof issuer !== 'string' || typeof authorizationEndpoint !== 'string' || typeof tokenEndpoint !== 'string') {
    throw new LegattoError('Niepełne metadane OAuth serwera biura.', { kind: 'server' });
  }
  if (sameOrigin(issuer) !== config.origin) {
    throw new LegattoError(
      `Serwer biura podaje inny adres kanoniczny (${issuer}). Wpisz ten adres w ustawieniach rozszerzenia.`,
      { kind: 'config' },
    );
  }
  if (sameOrigin(authorizationEndpoint) !== config.origin || sameOrigin(tokenEndpoint) !== config.origin) {
    throw new LegattoError('Endpointy OAuth serwera biura wskazują na inny host – logowanie przerwane.', {
      kind: 'server',
    });
  }
  const methods = Array.isArray(body.code_challenge_methods_supported) ? body.code_challenge_methods_supported : [];
  if (!methods.includes('S256')) {
    throw new LegattoError('Serwer biura nie obsługuje PKCE S256 – logowanie przerwane.', { kind: 'server' });
  }
  const grants = Array.isArray(body.grant_types_supported)
    ? body.grant_types_supported.filter((g) => typeof g === 'string')
    : ['authorization_code'];
  return {
    issuer,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    grant_types_supported: grants,
  };
}

/** Origin adresu albo '' dla niepoprawnego URL. @param {string} value */
function sameOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

/** @param {{ error?: unknown, code?: unknown }} body */
export function disabledMessage(body) {
  const reason = typeof body.error === 'string' ? `${body.error} ` : '';
  return `${reason}Integracja z Claude nie jest dostępna w tym biurze – skontaktuj się z administratorem.`;
}

/**
 * Lokalny serwer callbacku na 127.0.0.1 (losowy port) + adres autoryzacji do otwarcia w przeglądarce.
 * @param {{ metadata: AuthServerMetadata, clientId: string, timeoutMs: number }} options
 * @returns {Promise<{ authorizationUrl: string, redirectUri: string, verifier: string,
 *   result: Promise<{ code: string }>, close: () => void }>}
 */
export async function startLoopbackLogin({ metadata, clientId, timeoutMs }) {
  const verifier = createCodeVerifier();
  const state = createState();
  /** @type {(value: { code: string }) => void} */
  let resolveResult = () => {};
  /** @type {(reason: Error) => void} */
  let rejectResult = () => {};
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  let settled = false;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nie znaleziono');
      return;
    }
    if (settled) {
      sendPage(res, 410, 'Logowanie zostało już zakończone', 'Możesz zamknąć to okno.');
      return;
    }
    if (!stateMatches(url.searchParams.get('state'), state)) {
      // Obce żądanie (np. stara karta) nie kończy logowania - czekamy na właściwy callback.
      sendPage(res, 400, 'Nieprawidłowe żądanie', 'Ten link logowania jest nieaktualny. Wróć do Claude i spróbuj ponownie.');
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    settled = true;
    if (error) {
      const denied = error === 'access_denied';
      sendPage(
        res,
        200,
        denied ? 'Odmówiono dostępu' : 'Logowanie nie powiodło się',
        denied ? 'Claude nie otrzymał dostępu do portalu biura. Możesz zamknąć to okno.' : 'Wróć do Claude i spróbuj ponownie.',
      );
      finish(
        new LegattoError(
          denied
            ? 'Odmówiono dostępu Claude w portalu biura.'
            : `Logowanie do portalu biura nie powiodło się (${error.slice(0, 64)}).`,
          { kind: 'auth' },
        ),
      );
      return;
    }
    if (!code) {
      sendPage(res, 400, 'Logowanie nie powiodło się', 'Brak kodu autoryzacji. Wróć do Claude i spróbuj ponownie.');
      finish(new LegattoError('Serwer biura nie zwrócił kodu autoryzacji.', { kind: 'auth' }));
      return;
    }
    sendPage(res, 200, 'Zalogowano', 'Claude ma dostęp do portalu biura. Możesz zamknąć to okno i wrócić do Claude.');
    finish(null, code);
  });

  const timer = setTimeout(() => {
    settled = true;
    finish(
      new LegattoError(`Logowanie nie zostało dokończone w ciągu ${Math.round(timeoutMs / 60_000)} min. Spróbuj ponownie.`, {
        kind: 'login',
      }),
    );
  }, timeoutMs);
  timer.unref();

  /** @param {Error | null} err @param {string} [code] */
  function finish(err, code) {
    clearTimeout(timer);
    // Zamknięcie po wysłaniu odpowiedzi do przeglądarki.
    setImmediate(() => server.close());
    server.closeIdleConnections?.();
    if (err) rejectResult(err);
    else resolveResult({ code: /** @type {string} */ (code) });
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(undefined);
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authorizationUrl = new URL(metadata.authorization_endpoint);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('code_challenge', codeChallengeS256(verifier));
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('scope', OAUTH_SCOPE);

  return {
    authorizationUrl: authorizationUrl.toString(),
    redirectUri,
    verifier,
    result,
    close: () => {
      if (settled) return;
      settled = true;
      finish(new LegattoError('Logowanie przerwane – rozszerzenie zostało zamknięte.', { kind: 'login' }));
    },
  };
}

/** @param {string | null} received @param {string} expected */
function stateMatches(received, expected) {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const HTML_ESCAPES = /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' });

/** @param {import('node:http').ServerResponse} res @param {number} status @param {string} title @param {string} text */
function sendPage(res, status, title, text) {
  const esc = (/** @type {string} */ s) => s.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
  const html =
    '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>Legatto – ${esc(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#1f2937}h1{font-size:1.4rem}</style>` +
    `</head><body><h1>${esc(title)}</h1><p>${esc(text)}</p></body></html>`;
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Referrer-Policy': 'no-referrer',
    Connection: 'close',
  });
  res.end(html);
}

/**
 * @typedef {object} TokenResponse
 * @property {string} access_token
 * @property {number | null} expires_in
 * @property {string | null} refresh_token
 * @property {string | null} scope
 */

/**
 * Wywołanie token endpointu (client_secret_post, application/x-www-form-urlencoded).
 * @param {AuthServerMetadata} metadata
 * @param {Record<string, string>} params
 * @param {{ host: string, fetchImpl: typeof fetch }} options
 * @returns {Promise<TokenResponse>}
 */
export async function requestToken(metadata, params, { host, fetchImpl }) {
  const response = await httpRequest(
    metadata.token_endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    },
    { host, fetchImpl, timeoutMs: 30_000 },
  );
  const body = parseJson(await readText(response, 64 * 1024));
  if (!response.ok) {
    throw tokenError(response.status, body);
  }
  if (!body || typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new LegattoError('Serwer biura zwrócił niepoprawną odpowiedź z tokenem.', { kind: 'server' });
  }
  if (typeof body.token_type === 'string' && body.token_type.toLowerCase() !== 'bearer') {
    throw new LegattoError(`Nieobsługiwany typ tokenu: ${body.token_type.slice(0, 32)}.`, { kind: 'server' });
  }
  return {
    access_token: body.access_token,
    expires_in: Number.isFinite(body.expires_in) && body.expires_in > 0 ? body.expires_in : null,
    refresh_token: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
    scope: typeof body.scope === 'string' ? body.scope : null,
  };
}

/** @param {number} status @param {any} body */
function tokenError(status, body) {
  const code = body && typeof body.error === 'string' ? body.error : '';
  const description = body && typeof body.error_description === 'string' ? ` (${body.error_description.slice(0, 200)})` : '';
  if (code === 'invalid_client') {
    return new LegattoError(
      'Serwer biura odrzucił Client ID lub Client Secret. Sprawdź dane aplikacji OAuth w ustawieniach rozszerzenia ' +
        '(portal biura: Integracje → OAuth Apps).',
      { kind: 'config' },
    );
  }
  if (code === 'invalid_grant') {
    return new LegattoError(`Autoryzacja wygasła lub została odrzucona${description}. Zaloguj się ponownie.`, {
      kind: 'auth',
    });
  }
  if (status === 404 && body && (body.code === 'MCP_DISABLED' || body.code === 'AI_DISABLED')) {
    return new LegattoError(disabledMessage(body), { kind: 'server' });
  }
  return new LegattoError(`Serwer biura odrzucił żądanie tokenu (HTTP ${status}${code ? `, ${code}` : ''})${description}.`, {
    kind: status >= 500 ? 'server' : 'auth',
  });
}

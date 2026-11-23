// Konfiguracja rozszerzenia z user_config manifestu (zmienne środowiskowe ustawiane przez Claude Desktop).

import { LegattoError } from './errors.mjs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// Claude Desktop może zostawić nieuzupełnione pole opcjonalne jako dosłowny placeholder.
const PLACEHOLDER_RE = /^\$\{user_config\.[A-Za-z0-9_]+\}$/;
const MCP_TOKEN_RE = /^epm_[\x21-\x7e]{10,}$/;
const CLIENT_FIELD_RE = /^[\x21-\x7e]{1,200}$/;

function envValue(env, name) {
  const raw = env[name];
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  return PLACEHOLDER_RE.test(value) ? '' : value;
}

/**
 * Adres biura -> origin serwera. Przyjmuje `https://app.<domena>`, z końcowym `/` albo pełny
 * adres MCP `https://app.<domena>/api/mcp` (kopiowany z panelu). http tylko dla localhost.
 * @param {string} value
 */
export function parseOfficeUrl(value) {
  const example = 'Podaj adres portalu biura, np. https://app.twojadomena.pl';
  if (!value) {
    throw new LegattoError(`Brak adresu biura w ustawieniach rozszerzenia Legatto. ${example}`, { kind: 'config' });
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new LegattoError(`Niepoprawny adres biura „${value}”. ${example}`, { kind: 'config' });
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new LegattoError(`Adres biura musi zaczynać się od https:// („${value}”). ${example}`, { kind: 'config' });
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (url.username || url.password || url.search || url.hash || (path !== '' && path !== '/api/mcp')) {
    throw new LegattoError(`Niepoprawny adres biura „${value}” – wpisz sam adres portalu. ${example}`, {
      kind: 'config',
    });
  }
  return url.origin;
}

/**
 * @typedef {object} LegattoConfig
 * @property {string} origin       adres portalu biura (origin)
 * @property {string} host         host do komunikatów
 * @property {string} mcpUrl       endpoint MCP (`<origin>/api/mcp`)
 * @property {'oauth'|'token'} mode
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {string} mcpToken
 */

/**
 * @param {Record<string, string | undefined>} env
 * @returns {LegattoConfig}
 */
export function readConfig(env) {
  const origin = parseOfficeUrl(envValue(env, 'LEGATTO_OFFICE_URL'));
  const clientId = envValue(env, 'LEGATTO_CLIENT_ID');
  const clientSecret = envValue(env, 'LEGATTO_CLIENT_SECRET');
  const mcpToken = envValue(env, 'LEGATTO_MCP_TOKEN');
  const base = { origin, host: new URL(origin).host, mcpUrl: `${origin}/api/mcp`, clientId, clientSecret, mcpToken };

  if (mcpToken) {
    if (!MCP_TOKEN_RE.test(mcpToken)) {
      throw new LegattoError(
        'Niepoprawny token MCP w ustawieniach rozszerzenia (token zaczyna się od „epm_”). ' +
          'Wygeneruj nowy w portalu biura: Integracje → Tokeny MCP.',
        { kind: 'config' },
      );
    }
    return { ...base, mode: 'token' };
  }
  if (!clientId || !clientSecret) {
    throw new LegattoError(
      'Uzupełnij ustawienia rozszerzenia Legatto: Client ID i Client Secret aplikacji OAuth ' +
        '(portal biura: Integracje → OAuth Apps → „Nowa App”) albo token MCP.',
      { kind: 'config' },
    );
  }
  if (!CLIENT_FIELD_RE.test(clientId) || !CLIENT_FIELD_RE.test(clientSecret)) {
    throw new LegattoError('Client ID lub Client Secret zawiera niedozwolone znaki – skopiuj je ponownie z portalu.', {
      kind: 'config',
    });
  }
  return { ...base, mode: 'oauth' };
}

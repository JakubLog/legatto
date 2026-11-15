// Wspolne helpery serwera OAuth (authorize / code / token).

// Hosty (https, domyslny port) dopuszczone jako redirect_uri klienta OAuth (claude.ai).
const ALLOWED_REDIRECT_HOSTS: Record<string, true> = { 'claude.ai': true, 'app.claude.ai': true };
// Lokalni klienci MCP (Claude Desktop / Claude Code / inspector) - http lub https, dowolny port.
const LOOPBACK_HOSTS: Record<string, true> = { localhost: true, '127.0.0.1': true };

const MAX_REDIRECT_URI_LENGTH = 2048;

// Scisla walidacja redirect_uri. Zwraca sparsowany URL albo null, gdy adres jest
// niedozwolony. Uzywana identycznie w authorize, code (zgoda i odmowa) i token.
export function parseRedirectUri(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_REDIRECT_URI_LENGTH) {
    return null;
  }
  // Bialych znakow, znakow kontrolnych i backslashy parser URL po cichu nie zachowuje -
  // odrzucamy je, zeby zapisany string i faktyczny cel przekierowania byly tym samym.
  // RFC 6749 §3.1.2: redirect_uri nie moze zawierac fragmentu (#).
  // eslint-disable-next-line no-control-regex -- celowo wykrywamy znaki kontrolne
  if (/[\s\\#\u0000-\u001f\u007f]/.test(value)) return null;

  // Userinfo (np. http://localhost:@evil.com) odrzucamy juz na surowym stringu,
  // bo parser normalizuje puste userinfo do ''.
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?]*)/i.exec(value);
  if (!authority || authority[1].includes('@')) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;

  if (Object.hasOwn(LOOPBACK_HOSTS, url.hostname)) {
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  }
  if (url.protocol !== 'https:' || url.port !== '') return null;
  return Object.hasOwn(ALLOWED_REDIRECT_HOSTS, url.hostname) ? url : null;
}

// Parametr z query/body: tylko string (tablice i obiekty traktujemy jak brak).
export function stringParam(value: unknown, maxLength = 2048): string {
  return typeof value === 'string' && value.length <= maxLength ? value : '';
}

// PKCE S256: code_challenge = BASE64URL(SHA256(verifier)) - zawsze 43 znaki.
export const CODE_CHALLENGE_S256_RE = /^[A-Za-z0-9_-]{43}$/;

// Czas zycia tokenow MCP wydanych przez OAuth.
export const OAUTH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

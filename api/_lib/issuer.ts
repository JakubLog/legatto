import type { VercelRequest } from '@vercel/node';

// Publiczny adres instancji (OAuth issuer / baza linków MCP / adres wysyłki powiadomień).
// Jedna instancja = jeden poseł, więc domena nie może być wpisana w kod:
//   1. OAUTH_ISSUER (env Vercel), jeśli ustawione - adres kanoniczny instancji;
//   2. VERCEL_PROJECT_PRODUCTION_URL (zmienna systemowa Vercela: główna domena produkcyjna projektu),
//      dzięki czemu aliasy (*.vercel.app) i podglądy nie stają się osobnym issuerem;
//   3. inaczej (lokalnie) adres z żądania: x-forwarded-proto + x-forwarded-host / host.
// Poza localhost akceptujemy tylko https.

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/;
const LOCAL_HOST_RE = /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

export class IssuerError extends Error {}

function firstHeaderValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? '').split(',')[0].trim().toLowerCase();
}

function parseOrigin(raw: string, name: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new IssuerError(`${name} nie jest poprawnym adresem URL`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOST_RE.test(url.host))) {
    throw new IssuerError(`${name} musi używać https (http tylko dla localhost)`);
  }
  return url.origin;
}

/**
 * Kanoniczny adres instancji z konfiguracji (bez nagłówków żądania) albo null, gdy nieustalony
 * (lokalny serwer deweloperski bez OAUTH_ISSUER).
 */
export function configuredInstanceOrigin(): string | null {
  const issuer = process.env.OAUTH_ISSUER?.trim();
  if (issuer) return parseOrigin(issuer, 'OAUTH_ISSUER');
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return parseOrigin(`https://${production}`, 'VERCEL_PROJECT_PRODUCTION_URL');
  return null;
}

export function resolveIssuer(req: VercelRequest): string {
  const configured = configuredInstanceOrigin();
  if (configured) return configured;

  const host = firstHeaderValue(req.headers['x-forwarded-host']) || firstHeaderValue(req.headers.host);
  if (!host || !HOST_RE.test(host)) {
    throw new IssuerError('Nie można ustalić adresu instancji (brak lub niepoprawny nagłówek Host)');
  }
  const isLocal = LOCAL_HOST_RE.test(host);
  const proto = firstHeaderValue(req.headers['x-forwarded-proto']) || (isLocal ? 'http' : 'https');
  if (proto !== 'https' && !(proto === 'http' && isLocal)) {
    throw new IssuerError('Adres instancji musi używać https (http tylko dla localhost)');
  }
  return `${proto}://${host}`;
}

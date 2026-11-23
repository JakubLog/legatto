// Obsługa żądań publicznego listenera (:3000) z kolejnością Vercela:
//   1. /runtime-config.js (konfiguracja SPA z env kontenera),
//   2. pliki builda (dist/),
//   3. funkcje api/** (system plików),
//   4. rewrites z vercel.json → plik albo funkcja,
//   5. 404.
// Nagłówki `headers` z vercel.json dostaje każda odpowiedź (handler może je nadpisać).

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Surface } from '../src/lib/runtime-config-types.js';
import type { VercelHandler } from './handlers.js';
import { buildRuntimeConfig, renderRuntimeConfigScript } from './runtime-config.js';
import { matchApiRoute, type ApiFile } from './routes.js';
import type { StaticFiles } from './static.js';
import { BodyError, readBody, sendBodyError, toVercel } from './vercel-adapter.js';
import { applyRewrites, headersFor, maxDurationFor, type CompiledVercelConfig } from './vercel-config.js';

type Env = Record<string, string | undefined>;

export interface AppOptions {
  config: CompiledVercelConfig;
  /** Handler funkcji (statyczne importy w produkcji, ssrLoadModule w dev). */
  loadHandler: (file: ApiFile) => Promise<VercelHandler> | VercelHandler;
  staticFiles: StaticFiles | null;
  env: Env;
  version: string;
  /** Adresy proxy (Caddy na hoście), od których przyjmujemy X-Forwarded-* i X-Legatto-Surface. */
  trustedProxies: ReadonlySet<string>;
  /** Odpowiedzi w toku (graceful shutdown czeka, aż spadnie do zera). */
  onActivity?: (delta: 1 | -1) => void;
}

const FORWARDED_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'x-real-ip', 'forwarded', 'x-legatto-surface'];
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/;

/** Adres IPv4 zmapowany na IPv6 (::ffff:a.b.c.d) → a.b.c.d. */
function remoteAddress(req: IncomingMessage): string {
  const raw = req.socket.remoteAddress ?? '';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

/** Parsuje TRUSTED_PROXY_IPS (lista po przecinku). */
export function parseTrustedProxies(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Nagłówki proxy tylko od zaufanego proxy; od innych klientów są usuwane, a X-Forwarded-For/-Proto
 * ustawiane z gniazda (jak robi to Vercel na brzegu).
 */
function normalizeForwarded(req: IncomingMessage, trusted: ReadonlySet<string>): void {
  const remote = remoteAddress(req);
  if (trusted.has(remote)) return;
  for (const name of FORWARDED_HEADERS) delete req.headers[name];
  req.headers['x-forwarded-for'] = remote;
  req.headers['x-real-ip'] = remote;
  req.headers['x-forwarded-proto'] = 'http';
}

function firstValue(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? '').split(',')[0].trim().toLowerCase();
}

/** Origin, z którego przeglądarka załadowała stronę (po normalizacji nagłówków proxy). */
function requestOrigin(req: IncomingMessage): string | undefined {
  const host = firstValue(req.headers['x-forwarded-host']) || firstValue(req.headers.host);
  if (!host || !HOST_RE.test(host)) return undefined;
  const proto = firstValue(req.headers['x-forwarded-proto']) === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

function surfaceOf(req: IncomingMessage): Surface | null {
  const value = firstValue(req.headers['x-legatto-surface']);
  return value === 'crm' || value === 'admin' ? value : null;
}

function notFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end('The page could not be found\n\nNOT_FOUND\n');
}

export function createAppHandler(options: AppOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { config, staticFiles, env, version, trustedProxies } = options;

  const serveRuntimeConfig = (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.end();
      return;
    }
    const body = renderRuntimeConfigScript(
      buildRuntimeConfig(env, { version, origin: requestOrigin(req), surface: surfaceOf(req) }),
    );
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Host, X-Forwarded-Host, X-Legatto-Surface');
    res.setHeader('Content-Length', Buffer.byteLength(body));
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  const invoke = async (
    req: IncomingMessage,
    res: ServerResponse,
    file: ApiFile,
    pathname: string,
    query: URLSearchParams,
  ) => {
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch (err) {
      if (err instanceof BodyError) {
        sendBodyError(res, err);
        return;
      }
      throw err;
    }
    const search = query.toString();
    const target = toVercel(req, res, { url: `${pathname}${search ? `?${search}` : ''}`, query }, body);
    const handler = await options.loadHandler(file);
    const seconds = maxDurationFor(config, file);
    const timer = setTimeout(() => {
      console.error(`[server] ${file}: przekroczono maxDuration ${seconds} s`);
      if (!res.headersSent) {
        res.statusCode = 504;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'timeout' }));
      } else {
        res.destroy();
      }
    }, seconds * 1000);
    timer.unref();
    try {
      await handler(target.req, target.res);
    } catch (err) {
      if (err instanceof BodyError) {
        if (!res.headersSent) sendBodyError(res, err);
        else res.destroy();
        return;
      }
      // Bez treści żądania i bez komunikatu błędu (może nieść dane) - tylko trasa, typ błędu i ramki
      // stosu (wieloliniowy komunikat też jest w `stack`, więc tylko linie "at ...").
      console.error(`[server] ${file}: FUNCTION_INVOCATION_FAILED (${err instanceof Error ? err.name : typeof err})`);
      const frames = err instanceof Error ? (err.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line)).slice(0, 5) : [];
      if (frames.length > 0) console.error(frames.join('\n'));
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('A server error has occurred\n\nFUNCTION_INVOCATION_FAILED\n');
      } else {
        res.destroy();
      }
    } finally {
      clearTimeout(timer);
    }
  };

  return async (req, res) => {
    options.onActivity?.(1);
    res.on('close', () => options.onActivity?.(-1));
    try {
      normalizeForwarded(req, trustedProxies);
      let url: URL;
      try {
        url = new URL(req.url ?? '/', 'http://app.invalid');
      } catch {
        res.statusCode = 400;
        res.end();
        return;
      }
      const pathname = url.pathname;
      for (const [key, value] of headersFor(config, pathname)) res.setHeader(key, value);

      if (pathname === '/runtime-config.js') {
        serveRuntimeConfig(req, res);
        return;
      }
      const file = staticFiles?.resolve(pathname);
      if (file) {
        staticFiles!.serve(req, res, file);
        return;
      }
      const api = matchApiRoute(pathname);
      if (api) {
        const query = new URLSearchParams(url.search);
        for (const [k, v] of Object.entries(api.params)) query.set(k, v);
        await invoke(req, res, api.route.file, pathname, query);
        return;
      }
      const rewrite = applyRewrites(config, pathname);
      if (rewrite) {
        const query = new URLSearchParams(url.search);
        for (const [k, v] of rewrite.query) query.set(k, v);
        const target = staticFiles?.resolve(rewrite.pathname);
        if (target) {
          staticFiles!.serve(req, res, target);
          return;
        }
        const routed = matchApiRoute(rewrite.pathname);
        if (routed) {
          for (const [k, v] of Object.entries(routed.params)) query.set(k, v);
          await invoke(req, res, routed.route.file, rewrite.pathname, query);
          return;
        }
      }
      notFound(res);
    } catch (err) {
      console.error(`[server] błąd obsługi żądania (${err instanceof Error ? err.name : typeof err})`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      } else {
        res.destroy();
      }
    }
  };
}

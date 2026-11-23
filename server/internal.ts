// Listener wewnętrzny (:3001, tylko sieć legatto-int; Caddy go nie proxuje):
//   GET  /livez                                 - proces żyje (healthcheck kontenera),
//   GET  /healthz                               - konfiguracja + Auth i PostgREST przez api-gw
//                                                 (health check wydania `http:internal:/healthz`),
//   POST /_internal/auth-hooks/send-email       - Send Email Hook GoTrue,
//   GET  /_internal/auth-templates/invite.html  - szablon zaproszenia (fallback SMTP GoTrue).
// Odpowiedzi bez danych osobowych i bez wartości env - tylko nazwy kontroli i wynik.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { configuredInstanceOrigin } from '../api/_lib/issuer.js';
import { readPiiFieldKey } from '../api/_lib/pii-key.js';
import { handleSendEmailHook, type SendEmailHookDeps } from './auth-email-hook.js';
import { readBody, BodyError } from './vercel-adapter.js';

type Env = Record<string, string | undefined>;

/** Limit treści hooka (payload GoTrue to kilka kB). */
const HOOK_BODY_LIMIT = 256 * 1024;
const PROBE_TIMEOUT_MS = 3_000;

export interface InternalOptions {
  env: Env;
  version: string;
  hook: SendEmailHookDeps | null;
  inviteTemplate: string | null;
  /** Zapytanie do zależności (testy podstawiają atrapę). */
  fetchImpl?: typeof fetch;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(text));
  res.end(text);
}

/** Wymagana konfiguracja procesu app (bez wartości w odpowiedzi). */
export function configChecks(env: Env): Record<string, boolean> {
  let issuer = false;
  try {
    issuer = configuredInstanceOrigin() !== null;
  } catch {
    issuer = false;
  }
  return {
    supabase_url: Boolean(env.SUPABASE_URL?.trim()),
    anon_key: Boolean(env.SUPABASE_ANON_KEY?.trim()),
    service_role_key: Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    cron_secret: Boolean(env.CRON_SECRET?.trim()),
    oauth_issuer: issuer,
  };
}

async function probe(fetchImpl: typeof fetch, url: string, apiKey: string): Promise<boolean> {
  try {
    const res = await fetchImpl(url, { headers: { apikey: apiKey }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

export function createInternalHandler(options: InternalOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { env, version } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  const healthz = async (res: ServerResponse) => {
    const checks: Record<string, boolean> = configChecks(env);
    const base = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
    const anon = env.SUPABASE_ANON_KEY?.trim();
    if (base && anon) {
      const [auth, rest] = await Promise.all([
        probe(fetchImpl, `${base}/auth/v1/health`, anon),
        probe(fetchImpl, `${base}/rest/v1/`, anon),
      ]);
      checks.auth = auth;
      checks.rest = rest;
    }
    // Brak klucza PII to stan dopuszczalny (odblokowanie po restarcie); zły format to błąd.
    const piiKey = readPiiFieldKey(env).status;
    const ok = Object.values(checks).every(Boolean) && piiKey !== 'invalid';
    json(res, ok ? 200 : 503, { status: ok ? 'ok' : 'fail', version, checks, pii_key: piiKey });
  };

  return async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://internal.invalid').pathname;
    try {
      if (req.method === 'GET' && pathname === '/livez') {
        json(res, 200, { status: 'ok', version });
        return;
      }
      if (req.method === 'GET' && pathname === '/healthz') {
        await healthz(res);
        return;
      }
      if (req.method === 'POST' && pathname === '/_internal/auth-hooks/send-email') {
        if (!options.hook) {
          json(res, 503, { error: { http_code: 503, message: 'Hook nieskonfigurowany' } });
          return;
        }
        let body: Buffer;
        try {
          body = await readBody(req, HOOK_BODY_LIMIT);
        } catch (err) {
          if (err instanceof BodyError) {
            json(res, err.status, { error: { http_code: err.status, message: err.message } });
            return;
          }
          throw err;
        }
        const result = await handleSendEmailHook(options.hook, req.headers, body);
        json(res, result.status, result.body);
        return;
      }
      if (req.method === 'GET' && pathname === '/_internal/auth-templates/invite.html' && options.inviteTemplate) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(options.inviteTemplate);
        return;
      }
      json(res, 404, { error: 'not_found' });
    } catch (err) {
      console.error(`[internal] ${pathname}: ${err instanceof Error ? err.name : typeof err}`);
      if (!res.headersSent) json(res, 500, { error: 'internal' });
      else res.destroy();
    }
  };
}

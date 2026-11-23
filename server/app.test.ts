// Potok żądań serwera VPS na prawdziwym node:http: pliki builda, funkcje, rewrites, nagłówki,
// treść żądania, limit czasu, nagłówki proxy i /runtime-config.js.

import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppHandler } from './app';
import type { VercelHandler } from './handlers';
import type { ApiFile } from './routes';
import { StaticFiles } from './static';
import { MAX_BODY_BYTES } from './vercel-adapter';
import { compileVercelConfig, loadVercelConfig } from './vercel-config';

const ROOT = path.resolve(__dirname, '..');

/** Odpowiedź handlera `echo` (kształt ustala ten test). */
interface Echo {
  url: string;
  query: Record<string, unknown>;
  body: unknown;
  cookies: Record<string, string>;
  xff: string | null;
}

function echo(req: VercelRequest, res: VercelResponse): void {
  const payload: Echo = { url: req.url ?? '', query: req.query, body: req.body ?? null, cookies: req.cookies, xff: (req.headers['x-forwarded-for'] as string | undefined) ?? null };
  res.status(200).json(payload);
}

async function echoOf(res: Promise<Response>): Promise<Echo> {
  // Treść pochodzi z handlera `echo` tego testu (kształt Echo) - asercja zamiast walidatora.
  const body = (await (await res).json()) as Echo;
  return body;
}

let dist: string;
let server: http.Server;
let base: string;
const handlers: Partial<Record<ApiFile, VercelHandler>> = {};

function startServer(handler: http.RequestListener): Promise<http.Server> {
  const srv = http.createServer(handler);
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

beforeAll(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'legatto-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<title>%APP_TITLE%</title>');
  fs.writeFileSync(path.join(dist, 'assets', 'app-abc.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dist, 'favicon.svg'), '<svg/>');

  for (const file of ['api/mcp.ts', 'api/newsletter-view.ts', 'api/cron/[job].ts', 'api/oauth/discovery.ts'] as const) handlers[file] = echo;
  handlers['api/poliai.ts'] = (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders();
    res.write('data: 1\n\n');
    return new Promise<void>(() => {}); // handler, który nie kończy się sam - kończy go maxDuration
  };
  handlers['api/integracje.ts'] = () => {
    throw new Error('boom: dane osobowe w komunikacie');
  };
  handlers['api/notifications.ts'] = () => new Promise<void>(() => {});

  const fromFile = loadVercelConfig(path.join(ROOT, 'vercel.json'));
  // Limit 1 s (najmniejszy możliwy w vercel.json) do testu 504 / zerwania strumienia. Test integracyjny
  // na prawdziwych gniazdach - zegar serwera i fetch klienta nie dają się podmienić na sztuczny czas.
  const config = { ...fromFile, maxDurations: [...compileVercelConfig({ functions: { 'api/notifications.ts': { maxDuration: 1 }, 'api/poliai.ts': { maxDuration: 1 } } }).maxDurations, ...fromFile.maxDurations] };
  const app = createAppHandler({
    config,
    loadHandler: (file) => handlers[file] ?? echo,
    staticFiles: new StaticFiles(dist, { '/index.html': (html) => html.replace('%APP_TITLE%', 'Biuro X') }),
    env: { LEGATTO_TARGET: 'selfhost', SUPABASE_ANON_KEY: 'anon', APP_TITLE: 'Biuro X', INSTANCE_AI: 'off', INSTANCE_EMAIL: 'off', INSTANCE_MCP: 'on', ADMIN_ORIGIN: 'https://admin.app.example.pl' },
    version: '1.2.3',
    trustedProxies: new Set(['10.255.255.1']),
  });
  server = await startServer((req, res) => void app(req, res));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  fs.rmSync(dist, { recursive: true, force: true });
});

describe('pliki builda i SPA', () => {
  it('index.html z tytułem instancji i nagłówkami vercel.json', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<title>Biuro X</title>');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
  });

  it('assets z cache na rok, ETag i 304', async () => {
    const res = await fetch(`${base}/assets/app-abc.js`);
    expect(res.headers.get('cache-control')).toContain('immutable');
    const etag = res.headers.get('etag')!;
    const again = await fetch(`${base}/assets/app-abc.js`, { headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);
  });

  it('SPA fallback z rewrites, /api/* bez fallbacku', async () => {
    expect(await (await fetch(`${base}/biuro/sprawy/1`)).text()).toBe('<title>Biuro X</title>');
    const missing = await fetch(`${base}/api/brak`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('NOT_FOUND');
    expect((await fetch(`${base}/favicon.ico`)).headers.get('content-type')).toBe('image/svg+xml');
  });

  it('ścieżka z ../ nie wychodzi poza dist', async () => {
    const res = await fetch(`${base}/assets/%2e%2e/%2e%2e/etc/passwd`);
    expect(await res.text()).toBe('<title>Biuro X</title>');
  });
});

describe('funkcje', () => {
  it('parametr segmentu w query i url', async () => {
    const body = await echoOf(fetch(`${base}/api/cron/sync-ics?x=1`));
    expect(body.query).toEqual({ x: '1', job: 'sync-ics' });
    expect(body.url).toBe('/api/cron/sync-ics?x=1&job=sync-ics');
  });

  it('rewrite /n/:slug → newsletter-view z ?slug, inne nagłówki CSP', async () => {
    const res = await fetch(`${base}/n/numer-7`);
    expect((await echoOf(Promise.resolve(res))).query).toEqual({ slug: 'numer-7' });
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('JSON, formularz, cookies', async () => {
    const json = await echoOf(fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'a=1; b=x%20y' }, body: '{"k":[1]}' }));
    expect(json.body).toEqual({ k: [1] });
    expect(json.cookies).toEqual({ a: '1', b: 'x y' });
    const form = await echoOf(fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1&a=2&b=3' }));
    expect(form.body).toEqual({ a: ['1', '2'], b: '3' });
  });

  it('błędny JSON = 400, za duża treść = 413', async () => {
    const bad = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect(bad.status).toBe(400);
    const big = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x'.repeat(MAX_BODY_BYTES + 1) });
    expect(big.status).toBe(413);
  });

  it('wyjątek handlera = 500 bez treści błędu', async () => {
    const res = await fetch(`${base}/api/integracje`, { method: 'POST' });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('boom');
  });

  it('maxDuration: 504 przed nagłówkami, zerwanie strumienia po nich', async () => {
    const res = await fetch(`${base}/api/notifications`);
    expect(res.status).toBe(504);
    const stream = await fetch(`${base}/api/poliai`);
    expect(stream.status).toBe(200);
    await expect(stream.text()).rejects.toThrow();
  }, 10_000);
});

describe('nagłówki proxy i runtime-config', () => {
  it('X-Forwarded-* i X-Legatto-Surface od niezaufanego klienta są zastępowane', async () => {
    const body = await echoOf(fetch(`${base}/api/mcp`, { headers: { 'x-forwarded-for': '6.6.6.6', 'x-legatto-surface': 'admin' } }));
    expect(body.xff).toBe('127.0.0.1');
    const script = await (await fetch(`${base}/runtime-config.js`, { headers: { 'x-legatto-surface': 'admin', 'x-forwarded-host': 'evil.example' } })).text();
    expect(script).toContain('"surface":null');
    expect(script).toContain('"supabaseUrl":"http://127.0.0.1:');
  });

  it('runtime-config.js z env kontenera', async () => {
    const res = await fetch(`${base}/runtime-config.js`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const script = await res.text();
    const config = JSON.parse(/Object\.freeze\((.*)\);/.exec(script)![1]);
    expect(config).toMatchObject({
      version: '1.2.3',
      supabaseAnonKey: 'anon',
      appTitle: 'Biuro X',
      adminOrigin: 'https://admin.app.example.pl',
      icsAllowedHosts: [],
      instance: { ai: false, mcp: true, email: false, push: false, getresponse: false, ics: false },
    });
  });
});

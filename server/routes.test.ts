// Zgodność tras serwera VPS z Vercelem: każdy plik api/** ma trasę i handler, każda reguła
// vercel.json (rewrites, functions, crons) wskazuje istniejący cel.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_FILES, matchApiRoute } from './routes';
import { applyRewrites, loadVercelConfig, maxDurationFor, type VercelJson } from './vercel-config';

const ROOT = path.resolve(__dirname, '..');
const VERCEL_JSON = path.join(ROOT, 'vercel.json');
const config = loadVercelConfig(VERCEL_JSON);
const raw = JSON.parse(fs.readFileSync(VERCEL_JSON, 'utf8')) as VercelJson;

function apiFilesOnDisk(dir = path.join(ROOT, 'api')): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...apiFilesOnDisk(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }
  return out.sort();
}

describe('api/** → server/routes.ts', () => {
  it('lista tras = pliki funkcji na dysku (bez _lib)', () => {
    expect([...API_FILES].sort()).toEqual(apiFilesOnDisk());
  });

  it('server/handlers.ts importuje każdy plik z listy', () => {
    const source = fs.readFileSync(path.join(__dirname, 'handlers.ts'), 'utf8');
    for (const file of API_FILES) {
      expect(source).toContain(`'${file}':`);
      expect(source).toContain(`from '../${file.replace(/\.ts$/, '.js')}'`);
    }
  });

  it('ścieżki jak na Vercelu, z parametrem segmentu dynamicznego', () => {
    expect(matchApiRoute('/api/mcp')?.route.file).toBe('api/mcp.ts');
    expect(matchApiRoute('/api/oauth/token')?.route.file).toBe('api/oauth/token.ts');
    expect(matchApiRoute('/api/cron/sync-ics')).toMatchObject({ route: { file: 'api/cron/[job].ts' }, params: { job: 'sync-ics' } });
    expect(matchApiRoute('/api/_lib/supabase')).toBeNull();
    expect(matchApiRoute('/api/mcp/extra')).toBeNull();
    expect(matchApiRoute('/api')).toBeNull();
  });
});

describe('vercel.json', () => {
  it('każdy wpis functions dotyczy istniejącego pliku', () => {
    Object.keys(raw.functions ?? {}).forEach((glob, i) => {
      const [re] = config.maxDurations[i];
      expect(API_FILES.some((f) => re.test(f)), glob).toBe(true);
    });
  });

  it('limity czasu z functions', () => {
    expect(maxDurationFor(config, 'api/poliai.ts')).toBe(300);
    expect(maxDurationFor(config, 'api/mcp.ts')).toBe(30);
    expect(maxDurationFor(config, 'api/cron/[job].ts')).toBe(120);
  });

  it('crony wskazują trasę funkcji i mają nazwy jednostek', () => {
    expect(config.crons.length).toBe((raw.crons ?? []).length);
    for (const cron of config.crons) {
      expect(matchApiRoute(cron.path), cron.path).not.toBeNull();
      expect(cron.name).toMatch(/^[a-z0-9][a-z0-9-]{0,40}$/);
    }
  });

  it('każdy rewrite prowadzi do pliku builda albo funkcji', () => {
    const publicDir = path.join(ROOT, 'public');
    for (const rule of raw.rewrites ?? []) {
      const dest = rule.destination.split('?')[0];
      const isFunction = matchApiRoute(dest) !== null;
      const isFile = dest === '/index.html' || fs.existsSync(path.join(publicDir, dest));
      expect(isFunction || isFile, `${rule.source} → ${rule.destination}`).toBe(true);
    }
  });

  it('rewrites: semantyka segmentów i kolejność reguł', () => {
    expect(applyRewrites(config, '/n/moj-numer')).toMatchObject({ pathname: '/api/newsletter-view' });
    expect(applyRewrites(config, '/n/moj-numer')!.query.get('slug')).toBe('moj-numer');
    expect(applyRewrites(config, '/n/a%20b')!.query.get('slug')).toBe('a b');
    expect(applyRewrites(config, '/.well-known/oauth-authorization-server')!.pathname).toBe('/api/oauth/discovery');
    expect(applyRewrites(config, '/favicon.ico')!.pathname).toBe('/favicon.svg');
    expect(applyRewrites(config, '/biuro/sprawy/1')!.pathname).toBe('/index.html');
    expect(applyRewrites(config, '/api/nieistniejace')).toBeNull();
  });
});

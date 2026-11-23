import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main, type CliIo } from './cli';
import type { PublisherDb } from './db';
import * as render from './render';
import { GIF, JPEG_WITH_EXIF, PNG } from './testImages';

// Pełna ścieżka generatora na fixture: snapshot (atrapa bazy + lokalny serwer Storage) -> build
// (render z kodu źródłowego, atrapa builda klienta) -> strażnik zero-adres; plus walidacja argumentów.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'site', 'fixtures');
const DB_SNAPSHOT = JSON.parse(readFileSync(join(FIXTURES, 'db-snapshot.json'), 'utf8')) as unknown;
const DENY = ['crm.biuro.example', 'admin.crm.biuro.example', '100.64.0.7', 'abcdefgh.supabase.co'];

/** Obiekty publicznych bucketów serwowane przez atrapę Storage (Kong). */
const OBJECTS: Record<string, Uint8Array> = {
  'site-assets/homepage/1763740800000.jpg': JPEG_WITH_EXIF,
  'site-assets/blog/1763740800001.jpg': JPEG_WITH_EXIF,
  'site-assets/blog/1763740800002.png': PNG,
  'avatars/0b7e7a4e/avatar.png': GIF,
  'newsletter-assets/0b7e7a4e/1111111111111111111111111111111111111111111111111111111111111111.png': PNG,
};

let tmp: string;
let server: Server;
let storageUrl: string;
const storageHits: string[] = [];

interface RunResult {
  code: number;
  stdout: unknown;
  stderr: string[];
}

function fakeDb(calls: string[]): PublisherDb {
  return {
    claim: async () => {
      calls.push('claim');
      return { job: '9d7c2a0e-7a52-4c39-8d3e-6f0d2b1c0a11', reason: 'manual' };
    },
    snapshot: async () => {
      calls.push('snapshot');
      return structuredClone(DB_SNAPSHOT);
    },
    finish: async (job, status, deploymentId, error) => {
      calls.push(`finish ${job} ${status} ${deploymentId} ${error}`);
    },
    close: async () => {
      calls.push('close');
    },
  };
}

async function run(argv: string[], dbCalls: string[] = [], env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    connectDb: async () => fakeDb(dbCalls),
    loadRender: async () => render,
    env: { LEGATTO_SITE_DIST: join(tmp, 'site-dist'), ...env },
  };
  const code = await main(argv, io);
  expect(out).toHaveLength(1);
  return { code, stdout: JSON.parse(out[0]) as unknown, stderr: err };
}

/** Atrapa `pnpm build:site`: manifest Vite, JS/CSS wejścia, kopia public/ potrzebna generatorowi. */
function fakeSiteDist(dir: string): void {
  const client = join(dir, 'client');
  mkdirSync(join(client, '.vite'), { recursive: true });
  mkdirSync(join(client, '_app'), { recursive: true });
  mkdirSync(join(client, 'geo'), { recursive: true });
  mkdirSync(join(client, 'fonts', 'newsletter'), { recursive: true });
  mkdirSync(join(dir, 'server'), { recursive: true });
  writeFileSync(
    join(client, '.vite', 'manifest.json'),
    JSON.stringify({
      'site/client.tsx': { file: '_app/client-abc.js', css: ['_app/client-abc.css'], imports: ['_vendor'], isEntry: true },
      _vendor: { file: '_app/vendor-def.js' },
    }),
  );
  writeFileSync(join(client, '_app', 'client-abc.js'), 'import "./vendor-def.js";');
  writeFileSync(join(client, '_app', 'vendor-def.js'), 'export {};');
  writeFileSync(join(client, '_app', 'client-abc.css'), 'body{margin:0}');
  writeFileSync(join(dir, 'server', 'render.js'), '// atrapa - test ładuje site/render.tsx');
  for (const name of ['logo.svg', 'favicon.svg']) copyFileSync(join(ROOT, 'public', name), join(client, name));
  for (const level of ['powiaty', 'gminy']) {
    copyFileSync(join(ROOT, 'public', 'geo', `okreg-35-${level}.geojson`), join(client, 'geo', `okreg-35-${level}.geojson`));
  }
  for (const name of readdirSync(join(ROOT, 'public', 'fonts', 'newsletter'))) {
    copyFileSync(join(ROOT, 'public', 'fonts', 'newsletter', name), join(client, 'fonts', 'newsletter', name));
  }
}

function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'legatto-site-'));
  fakeSiteDist(join(tmp, 'site-dist'));
  server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '').replace(/^\/storage\/v1\/object\/public\//, ''));
    storageHits.push(path);
    const body = OBJECTS[path];
    if (!body) {
      res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"not_found"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // listen(0) na TCP - address() to zawsze AddressInfo (string tylko dla gniazd unix).
  const address = server.address() as AddressInfo;
  storageUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(tmp, { recursive: true, force: true });
});

describe('site cli: argumenty', () => {
  it('brak komendy, nieznana komenda i nieznana opcja -> kod 2', async () => {
    expect((await run([])).code).toBe(2);
    expect((await run(['deploy'])).code).toBe(2);
    expect((await run(['claim', '--force'])).code).toBe(2);
    expect((await run(['snapshot'])).code).toBe(2);
    expect((await run(['snapshot', '--out', join(tmp, 'x'), '--storage-url', 'ftp://api-gw'])).code).toBe(2);
    expect((await run(['build', '--snapshot', tmp, '--out', join(tmp, 'y')])).code).toBe(2);
  });

  it('finish: walidacja job/status/deployment-id/error', async () => {
    const job = '9d7c2a0e-7a52-4c39-8d3e-6f0d2b1c0a11';
    expect((await run(['finish', '--job', 'nie-uuid', '--status', 'ok'])).code).toBe(2);
    expect((await run(['finish', '--job', job, '--status', 'done'])).code).toBe(2);
    expect((await run(['finish', '--job', job, '--status', 'ok', '--deployment-id', 'a b'])).code).toBe(2);
    expect((await run(['finish', '--job', job, '--status', 'failed', '--error', 'Złe!'])).code).toBe(2);

    const calls: string[] = [];
    const result = await run(['finish', '--job', job, '--status', 'failed', '--error', 'guard:zero_address'], calls);
    expect(result).toMatchObject({ code: 0, stdout: { ok: true, job, status: 'failed' } });
    expect(calls).toEqual([`finish ${job} failed null guard:zero_address`, 'close']);
  });

  it('claim: wynik joba z bazy', async () => {
    const calls: string[] = [];
    const result = await run(['claim'], calls);
    expect(result).toEqual({ code: 0, stdout: { job: '9d7c2a0e-7a52-4c39-8d3e-6f0d2b1c0a11', reason: 'manual' }, stderr: [] });
    expect(calls).toEqual(['claim', 'close']);
  });

  it('build: zły site-config -> kod 4', async () => {
    const config = join(tmp, 'bad-config.json');
    writeFileSync(config, JSON.stringify({ v: 1, origin: 'http://jan-kowalski.example' }));
    const result = await run(['build', '--snapshot', tmp, '--site-config', config, '--out', join(tmp, 'z')]);
    expect(result).toMatchObject({ code: 4, stdout: { ok: false, error: 'config' } });
  });

  it('build: brak builda strony -> kod 4', async () => {
    const result = await run(
      ['build', '--snapshot', tmp, '--site-config', join(FIXTURES, 'site-config.json'), '--out', join(tmp, 'z2')],
      [],
      { LEGATTO_SITE_DIST: join(tmp, 'brak') },
    );
    expect(result).toMatchObject({ code: 4, stdout: { ok: false, error: 'config' } });
  });
});

describe('site cli: snapshot + build na fixture', () => {
  const snapshotDir = () => join(tmp, 'snapshot');
  const distDir = () => join(tmp, 'dist');

  it('snapshot: zasoby z dozwolonych bucketów, JPEG bez EXIF, referencje przepisane', async () => {
    const result = await run(['snapshot', '--out', snapshotDir(), '--storage-url', storageUrl]);
    expect(result.code).toBe(0);
    // 5 obiektów, 3 różne treści (pliki adresowane sha256: te same bajty = jeden plik).
    expect(result.stdout).toEqual({ ok: true, assets: 3, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    // Obce hosty nigdy nie są pobierane.
    expect(storageHits.every((hit) => !hit.includes('tracker'))).toBe(true);

    const snapshot = JSON.parse(readFileSync(join(snapshotDir(), 'snapshot.json'), 'utf8')) as {
      identity: { photo_url: string };
      staff: { avatar_url: string | null }[];
      posts: { cover_path: string; body_md: string }[];
      newsletters: { html_web: string }[];
      newsletter_assets: { sha256: string; ext: string; path: string }[];
    };
    expect(snapshot.identity.photo_url).toMatch(/^\/assets\/[0-9a-f]{64}\.jpg$/);
    expect(snapshot.staff.map((s) => s.avatar_url)).toEqual([expect.stringMatching(/^\/assets\/[0-9a-f]{64}\.gif$/), null]);
    expect(snapshot.posts[0].cover_path).toMatch(/^\/assets\/[0-9a-f]{64}\.png$/);
    expect(snapshot.posts[0].body_md).toMatch(/!\[Zdjęcie z dyżuru\]\(\/assets\/[0-9a-f]{64}\.jpg\)/);
    expect(snapshot.posts[0].body_md).not.toContain('tracker.example.net');
    expect(snapshot.newsletters[0].html_web).toMatch(/<img src="\/n\/a\/[0-9a-f]{64}\.png"/);
    expect(snapshot.newsletters[0].html_web).not.toContain('tracker.example.net');
    expect(snapshot.newsletter_assets).toHaveLength(1);

    const assets = readdirSync(join(snapshotDir(), 'assets'));
    expect(assets).toHaveLength(3);
    const jpg = assets.find((name) => name.endsWith('.jpg'));
    const jpegText = readFileSync(join(snapshotDir(), 'assets', jpg ?? '')).toString('latin1');
    expect(jpegText).not.toContain('Exif');
    expect(jpegText).not.toContain('GPS');
    expect(JSON.stringify(snapshot)).not.toMatch(/supabase|\/storage\/v1/);
  });

  it('build: strona statyczna przechodzi strażnika zero-adres', async () => {
    const result = await run([
      'build',
      '--snapshot',
      snapshotDir(),
      '--site-config',
      join(FIXTURES, 'site-config.json'),
      '--out',
      distDir(),
      ...DENY.flatMap((host) => ['--deny-host', host]),
    ]);
    expect(result.stderr).toEqual([]);
    expect(result.code).toBe(0);
    const files = listFiles(distDir()).sort();
    expect(result.stdout).toMatchObject({ ok: true, files: files.length });

    for (const expected of [
      'index.html',
      '404.html',
      'blog/index.html',
      'blog/pierwszy-wpis/index.html',
      'n/AbCdEfGhIjKlMnOp/index.html',
      'data/form-dictionaries.json',
      'data/form-key.json',
      '_headers',
      'robots.txt',
      '_app/client-abc.js',
      '_app/vendor-def.js',
      '_app/client-abc.css',
      'logo.svg',
      'fonts/newsletter/source-sans-3-latin-wght-normal.woff2',
    ]) {
      expect(files).toContain(expected);
    }
    expect(files.filter((f) => f.startsWith('assets/'))).toHaveLength(3);
    expect(files.filter((f) => f.startsWith('n/a/'))).toHaveLength(1);
    expect(existsSync(join(distDir(), 'geo'))).toBe(false);

    const home = readFileSync(join(distDir(), 'index.html'), 'utf8');
    expect(home).toContain('<title>Biuro Poselskie Jana Kowalskiego</title>');
    expect(home).toContain('Jana Kowalskiego');
    expect(home).toContain('Biuro Poselskie w Olsztynie');
    expect(home).toContain('<script type="module" src="/_app/client-abc.js"></script>');
    expect(home).toContain('<link rel="modulepreload" href="/_app/vendor-def.js">');
    expect(home).toContain('data-island="submit-form"');
    expect(home).toContain('data-island="calendar"');
    expect(home).toContain('<svg viewBox'); // mapa okręgu w HTML
    expect(home).toContain('href="/blog/"');
    expect(home).toContain('1x00000000000000000000AA');
    // Bez linków portalu biura.
    expect(home).not.toMatch(/href="\/(login|biuro)/);
    expect(home).not.toContain('Logowanie pracowników');

    const post = readFileSync(join(distDir(), 'blog', 'pierwszy-wpis', 'index.html'), 'utf8');
    expect(post).toMatch(/<img src="\/assets\/[0-9a-f]{64}\.jpg" alt="Zdjęcie z dyżuru"/);
    expect(post).toContain('<table');
    expect(post).not.toContain('<script>alert');
    expect(post).toContain('href="/#biura"');

    const headers = readFileSync(join(distDir(), '_headers'), 'utf8');
    expect(headers).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(headers).toContain('Strict-Transport-Security');
    expect(headers).toMatch(/\/n\/\*\n {2}! Content-Security-Policy\n {2}Content-Security-Policy: sandbox;/);
    expect(headers).toContain('X-Robots-Tag: noindex');

    expect(JSON.parse(readFileSync(join(distDir(), 'data', 'form-key.json'), 'utf8'))).toEqual(
      JSON.parse(readFileSync(join(FIXTURES, 'site-config.json'), 'utf8')).form_key,
    );
    expect(JSON.parse(readFileSync(join(distDir(), 'data', 'form-dictionaries.json'), 'utf8'))).toEqual({
      v: 1,
      powiaty: [
        { id: 1, name: 'Olsztyn' },
        { id: 2, name: 'olsztyński' },
      ],
      gminy: [
        { id: 1, powiat_id: 1, name: 'Olsztyn' },
        { id: 2, powiat_id: 2, name: 'Barczewo' },
      ],
      categories: [
        { id: 1, name: 'Drogi i transport' },
        { id: 2, name: 'Zdrowie' },
      ],
    });
  });

  it('build: niepusty katalog wyjściowy -> błąd', async () => {
    const result = await run(['build', '--snapshot', snapshotDir(), '--site-config', join(FIXTURES, 'site-config.json'), '--out', distDir()]);
    expect(result).toMatchObject({ code: 1, stdout: { ok: false } });
  });

  it('build: adres biura w treści -> kod 20', async () => {
    const leaky = join(tmp, 'snapshot-leak');
    mkdirSync(join(leaky, 'assets'), { recursive: true });
    for (const name of readdirSync(join(snapshotDir(), 'assets'))) {
      copyFileSync(join(snapshotDir(), 'assets', name), join(leaky, 'assets', name));
    }
    const snapshot = JSON.parse(readFileSync(join(snapshotDir(), 'snapshot.json'), 'utf8')) as {
      homepage: { footer: { tagline: string } };
    };
    snapshot.homepage.footer.tagline = 'Panel: https://CRM.biuro.example/biuro';
    writeFileSync(join(leaky, 'snapshot.json'), JSON.stringify(snapshot));
    const result = await run([
      'build',
      '--snapshot',
      leaky,
      '--site-config',
      join(FIXTURES, 'site-config.json'),
      '--out',
      join(tmp, 'dist-leak'),
      '--deny-host',
      'crm.biuro.example',
    ]);
    expect(result.code).toBe(20);
    expect(result.stdout).toMatchObject({ ok: false, error: 'zero_address' });
    expect(result.stderr.join('\n')).toContain('index.html: host crm.biuro.example');
  });
});

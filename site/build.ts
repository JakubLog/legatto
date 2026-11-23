// `site.mjs build`: przygotowana migawka + site-config -> statyczna strona posła (Cloudflare Pages).
// Bez sieci (`--network none`): wszystko z DIR migawki i z /app/site/dist (build klienta + render.js).
// Wynik: strony HTML (/, /blog/, /blog/<slug>/, 404), /n/<slug>/ (newslettery), /n/a/*, /assets/*,
// /_app/* (JS wysp, CSS, fonty), /fonts/newsletter/*, /data/form-dictionaries.json, /data/form-key.json,
// _headers, robots.txt; na końcu strażnik zero-adres (site/guard.ts).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FeatureCollection } from 'geojson';
import { z } from 'zod';
import { formKeySchema, parseFormKey } from '../packages/public-submission/src/index';
import { siteSnapshotSchema, type SiteSnapshot } from '../src/lib/siteSnapshot';
import { SITE_ASSET_URL_RE } from './assets';
import { guardDist, type GuardResult } from './guard';
import type { ClientAssets, RenderedPage, RenderInput } from './render';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}

/** site-config (interfejs app↔publicsite §6): origin strony, sitekey Turnstile, klucz publiczny formularza. */
export const siteConfigSchema = z
  .object({
    v: z.literal(1),
    origin: z.string().regex(/^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/, 'origin: https://domena bez ścieżki'),
    turnstile_sitekey: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'turnstile_sitekey: niepoprawny'),
    form_key: formKeySchema,
  })
  .strict();
export type SiteConfig = z.infer<typeof siteConfigSchema>;

export function loadSiteConfig(file: string): SiteConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new ConfigError(`site-config: nie można odczytać JSON z ${file}`);
  }
  const parsed = siteConfigSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`site-config: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  try {
    parseFormKey(parsed.data.form_key);
  } catch {
    throw new ConfigError('site-config: form_key.kid nie pasuje do klucza x25519');
  }
  return parsed.data;
}

export interface RenderModule {
  renderSite(input: RenderInput): RenderedPage[];
}

export interface BuildOptions {
  /** Katalog z `snapshot` (snapshot.json + assets/). */
  snapshotDir: string;
  siteConfig: SiteConfig;
  /** Katalog wynikowy (nie istnieje albo pusty). */
  outDir: string;
  denyHosts: readonly string[];
  /** Build klienta (`site/dist/client`: _app/, .vite/manifest.json, kopia public/). */
  clientDir: string;
  render: RenderModule;
  now?: Date;
}

const CLIENT_ENTRY = 'site/client.tsx';
const STATIC_FILES = ['logo.svg', 'favicon.svg', 'apple-touch-icon.png'];
const NEWSLETTER_FONT_FILE = /^[A-Za-z0-9._-]+\.(woff2|woff|txt)$/;

// Globalny CSP strony (phase0 §7 pkt 5): skrypty tylko własne + Turnstile; dane tylko z własnego originu
// (Worker /api/*). /n/* (newsletter z treścią z przeglądarki redakcji) - sandbox jak api/newsletter-view.ts.
const SITE_CSP =
  "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const NEWSLETTER_CSP =
  "sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const HEADERS = `/*
  Content-Security-Policy: ${SITE_CSP}
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Cross-Origin-Opener-Policy: same-origin

/n/*
  ! Content-Security-Policy
  Content-Security-Policy: ${NEWSLETTER_CSP}
  X-Robots-Tag: noindex, nofollow

/_app/*
  Cache-Control: public, max-age=31536000, immutable

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/n/a/*
  Cache-Control: public, max-age=31536000, immutable

/data/*
  Cache-Control: no-cache
`;

const ROBOTS = `User-agent: *
Allow: /
Disallow: /n/
Disallow: /data/
`;

function writeOut(outDir: string, relPath: string, content: string | Uint8Array): void {
  const target = join(outDir, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, { mode: 0o644 });
}

function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    if (entry.isDirectory()) copyTree(source, join(to, entry.name));
    else copyFileSync(source, join(to, entry.name));
  }
}

interface ManifestChunk {
  file: string;
  css?: string[];
  imports?: string[];
  isEntry?: boolean;
}

/** Pliki wejścia klienta z manifestu Vite: skrypt, CSS (także importowanych chunków), modulepreload. */
export function clientAssets(clientDir: string): ClientAssets {
  const manifestFile = join(clientDir, '.vite', 'manifest.json');
  let manifest: Record<string, ManifestChunk>;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, ManifestChunk>;
  } catch {
    throw new ConfigError(`brak manifestu klienta ${manifestFile} (pnpm build:site)`);
  }
  const entry = manifest[CLIENT_ENTRY];
  if (!entry?.isEntry) throw new ConfigError(`manifest klienta bez wejścia ${CLIENT_ENTRY}`);
  const css = new Set(entry.css ?? []);
  const preload = new Set<string>();
  const visit = (key: string) => {
    const chunk = manifest[key];
    if (!chunk || preload.has(chunk.file)) return;
    preload.add(chunk.file);
    for (const file of chunk.css ?? []) css.add(file);
    for (const next of chunk.imports ?? []) visit(next);
  };
  for (const key of entry.imports ?? []) visit(key);
  return {
    entry: `/${entry.file}`,
    css: [...css].map((file) => `/${file}`),
    preload: [...preload].map((file) => `/${file}`),
  };
}

/** Migawka po `snapshot`: każdy obraz już lokalny (inaczej strona ładowałaby zdjęcia z Storage). */
function assertPrepared(snapshot: SiteSnapshot): void {
  const bad: string[] = [];
  if (snapshot.identity.photo_url && !SITE_ASSET_URL_RE.test(snapshot.identity.photo_url)) bad.push('identity.photo_url');
  for (const person of snapshot.staff) {
    if (person.avatar_url && !SITE_ASSET_URL_RE.test(person.avatar_url)) bad.push(`staff ${person.id}`);
  }
  for (const post of snapshot.posts) {
    if (post.cover_path && !SITE_ASSET_URL_RE.test(post.cover_path)) bad.push(`posts ${post.slug}`);
  }
  if (bad.length > 0) throw new BuildError(`migawka nieprzygotowana (uruchom snapshot): ${bad.slice(0, 5).join(', ')}`);
}

function readGeo(clientDir: string, snapshot: SiteSnapshot): RenderInput['geo'] {
  const number = snapshot.district?.number;
  if (!number || !snapshot.homepage.offices.show_map) return null;
  const load = (level: 'powiaty' | 'gminy'): FeatureCollection | null => {
    const file = join(clientDir, 'geo', `okreg-${number}-${level}.geojson`);
    if (!existsSync(file)) return null;
    const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<FeatureCollection>;
    return data.type === 'FeatureCollection' && Array.isArray(data.features) ? (data as FeatureCollection) : null;
  };
  const powiaty = load('powiaty');
  const gminy = load('gminy');
  return powiaty && gminy ? { powiaty, gminy } : null;
}

function copyAsset(snapshotDir: string, outDir: string, name: string, target: string): void {
  const source = join(snapshotDir, 'assets', name);
  if (!existsSync(source)) throw new BuildError(`brak pliku zasobu ${name} w migawce`);
  mkdirSync(dirname(join(outDir, target)), { recursive: true });
  copyFileSync(source, join(outDir, target));
}

export function buildSite(options: BuildOptions): GuardResult {
  const { snapshotDir, siteConfig, outDir, clientDir } = options;
  if (existsSync(outDir) && readdirSync(outDir).length > 0) throw new BuildError(`katalog wyjściowy ${outDir} nie jest pusty`);
  mkdirSync(outDir, { recursive: true });

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(snapshotDir, 'snapshot.json'), 'utf8'));
  } catch {
    throw new BuildError(`nie można odczytać ${join(snapshotDir, 'snapshot.json')}`);
  }
  const parsed = siteSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BuildError(`snapshot.json niezgodny ze schematem: ${issue?.path.join('.')} ${issue?.message}`);
  }
  const snapshot = parsed.data;
  assertPrepared(snapshot);

  const assets = clientAssets(clientDir);
  copyTree(join(clientDir, '_app'), join(outDir, '_app'));
  for (const name of STATIC_FILES) {
    const source = join(clientDir, name);
    if (existsSync(source)) copyFileSync(source, join(outDir, name));
  }
  const fontsDir = join(clientDir, 'fonts', 'newsletter');
  if (existsSync(fontsDir)) {
    for (const name of readdirSync(fontsDir).filter((n) => NEWSLETTER_FONT_FILE.test(n))) {
      writeOut(outDir, `fonts/newsletter/${name}`, readFileSync(join(fontsDir, name)));
    }
  }

  const pages = options.render.renderSite({
    snapshot,
    origin: siteConfig.origin,
    turnstileSiteKey: siteConfig.turnstile_sitekey,
    geo: readGeo(clientDir, snapshot),
    client: assets,
    now: (options.now ?? new Date()).toISOString(),
  });
  for (const page of pages) {
    writeOut(outDir, page.path, page.html);
    for (const match of page.html.matchAll(/\/assets\/([0-9a-f]{64})\.(png|jpg|webp|gif)/g)) {
      const name = `${match[1]}.${match[2]}`;
      if (!existsSync(join(outDir, 'assets', name))) copyAsset(snapshotDir, outDir, name, `assets/${name}`);
    }
  }

  for (const issue of snapshot.newsletters) {
    if (!issue.html_web.trim()) continue;
    writeOut(outDir, `n/${issue.slug}/index.html`, issue.html_web);
    for (const match of issue.html_web.matchAll(/\/n\/a\/([0-9a-f]{64})\.(png|jpg|webp|gif)/g)) {
      const name = `${match[1]}.${match[2]}`;
      if (!existsSync(join(outDir, 'n', 'a', name))) copyAsset(snapshotDir, outDir, name, `n/a/${name}`);
    }
  }

  const { powiaty, gminy, categories } = snapshot.dictionaries;
  writeOut(
    outDir,
    'data/form-dictionaries.json',
    `${JSON.stringify({
      v: 1,
      powiaty: powiaty.map(({ id, name }) => ({ id, name })),
      gminy: gminy.map(({ id, powiat_id, name }) => ({ id, powiat_id, name })),
      categories: categories.map(({ id, name }) => ({ id, name })),
    })}\n`,
  );
  writeOut(outDir, 'data/form-key.json', `${JSON.stringify(siteConfig.form_key)}\n`);
  writeOut(outDir, '_headers', HEADERS);
  writeOut(outDir, 'robots.txt', ROBOTS);

  return guardDist(outDir, options.denyHosts);
}

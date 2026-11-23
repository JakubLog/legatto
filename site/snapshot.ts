// `site.mjs snapshot`: migawka z bazy -> DIR/snapshot.json + DIR/assets/<sha256>.<ext>.
// Zdjęcia pobierane z publicznych bucketów przez wewnętrzny adres Storage (Kong, `--storage-url`),
// sprawdzane po magic bytes (png/jpeg/webp/gif), JPEG bez metadanych (EXIF/XMP/IPTC), nazwa = sha256
// treści. W migawce referencje przepisane na /assets/<sha256>.<ext> (newsletter: /n/a/...);
// obrazy z innych hostów i bucketów odrzucane (usunięte z treści).

import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SiteNewsletterAsset, SiteSnapshot } from '../src/lib/siteSnapshot';
import {
  detectImageType,
  NEWSLETTER_ASSET_URL_RE,
  parseStorageUrl,
  rewriteMarkdownImages,
  rewriteNewsletterHtml,
  stripJpegMetadata,
  type AssetResolver,
  type LocalAsset,
  type StorageRef,
} from './assets';

/** Maks. rozmiar pobieranego obrazu (limit Pages to 25 MiB na plik). */
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;

export interface StorageResponse {
  status: number;
  body: Uint8Array;
}

/** Pobranie obiektu (test seam); błąd sieci = wyjątek (przerywa snapshot, publisher ponowi job). */
export type StorageFetch = (url: string) => Promise<StorageResponse>;

export interface PrepareOptions {
  /** Adres Storage widziany z kontenera, np. http://api-gw:8000. */
  storageUrl: string;
  /** Katalog migawki (DIR); obrazy trafiają do DIR/assets. */
  outDir: string;
  fetch: StorageFetch;
  warn: (message: string) => void;
}

export interface PreparedSnapshot {
  snapshot: SiteSnapshot;
  /** Liczba plików w DIR/assets. */
  assets: number;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

const BLOG_COVER_RE = /^blog\/[A-Za-z0-9._-]{1,120}$/;

/** Domyślny fetch Node: bez przekierowań, z limitem rozmiaru i czasu. */
export function nodeStorageFetch(timeoutMs = 30_000): StorageFetch {
  return async (url) => {
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_ASSET_BYTES) {
      await res.body?.cancel();
      return { status: 413, body: new Uint8Array() };
    }
    const body = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, body: body.length > MAX_ASSET_BYTES ? new Uint8Array() : body };
  };
}

class AssetStore {
  private readonly pending = new Map<string, Promise<LocalAsset | null>>();
  private readonly files = new Set<string>();
  private readonly assetsDir: string;

  constructor(private readonly options: PrepareOptions) {
    this.assetsDir = join(options.outDir, 'assets');
    mkdirSync(this.assetsDir, { recursive: true });
  }

  get count(): number {
    return this.files.size;
  }

  fromStorage(ref: StorageRef): Promise<LocalAsset | null> {
    const key = `${ref.bucket}/${ref.path}`;
    let promise = this.pending.get(key);
    if (!promise) {
      promise = this.download(ref);
      this.pending.set(key, promise);
    }
    return promise;
  }

  private async download(ref: StorageRef): Promise<LocalAsset | null> {
    const base = this.options.storageUrl.replace(/\/+$/, '');
    const objectPath = ref.path.split('/').map(encodeURIComponent).join('/');
    const label = `${ref.bucket}/${ref.path}`;
    let res: StorageResponse;
    try {
      res = await this.options.fetch(`${base}/storage/v1/object/public/${ref.bucket}/${objectPath}`);
    } catch (err) {
      throw new StorageError(`pobieranie ${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // 400/404: obiekt usunięty (Storage zwraca 400 „not_found”) - pomijamy obraz, strona dalej działa.
    if (res.status === 400 || res.status === 404) {
      this.options.warn(`pominięto ${label}: brak obiektu (HTTP ${res.status})`);
      return null;
    }
    if (res.status === 413) {
      this.options.warn(`pominięto ${label}: plik większy niż ${MAX_ASSET_BYTES} B`);
      return null;
    }
    if (res.status !== 200) throw new StorageError(`pobieranie ${label}: HTTP ${res.status}`);
    const ext = detectImageType(res.body);
    if (!ext) {
      this.options.warn(`pominięto ${label}: nieobsługiwany format (dozwolone png, jpeg, webp, gif)`);
      return null;
    }
    let bytes = res.body;
    if (ext === 'jpg') {
      try {
        bytes = stripJpegMetadata(bytes);
      } catch (err) {
        this.options.warn(`pominięto ${label}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const name = `${sha256}.${ext}`;
    if (!this.files.has(name)) {
      writeFileSync(join(this.assetsDir, name), bytes, { mode: 0o644 });
      this.files.add(name);
    }
    return { sha256, ext };
  }
}

/** Przepisuje zasoby migawki na lokalne i zapisuje obrazy w DIR/assets. */
export async function prepareSnapshot(raw: SiteSnapshot, options: PrepareOptions): Promise<PreparedSnapshot> {
  const store = new AssetStore(options);
  const newsletterObjects = new Map(raw.newsletter_assets.map((a) => [`${a.sha256}.${a.ext}`, a.path]));

  const resolve: AssetResolver = async (url) => {
    const storage = parseStorageUrl(url);
    if (storage) return store.fromStorage(storage);
    let pathname = '';
    try {
      pathname = new URL(url, 'http://local.invalid').pathname;
    } catch {
      return null;
    }
    const newsletter = NEWSLETTER_ASSET_URL_RE.exec(pathname);
    const objectPath = newsletter ? newsletterObjects.get(`${newsletter[1]}.${newsletter[2]}`) : undefined;
    if (objectPath) {
      const ref = parseStorageUrl(`/storage/v1/object/public/newsletter-assets/${objectPath}`);
      if (ref) return store.fromStorage(ref);
    }
    options.warn(`odrzucono obraz spoza dozwolonych bucketów: ${url.slice(0, 120)}`);
    return null;
  };
  const toSitePath = (asset: LocalAsset | null) => (asset ? `/assets/${asset.sha256}.${asset.ext}` : null);

  const identity = { ...raw.identity };
  if (identity.photo_url) identity.photo_url = toSitePath(await resolve(identity.photo_url)) ?? '';

  const staff = [];
  for (const person of raw.staff) {
    staff.push({ ...person, avatar_url: person.avatar_url ? toSitePath(await resolve(person.avatar_url)) : null });
  }

  const posts = [];
  for (const post of raw.posts) {
    let cover = '';
    if (post.cover_path) {
      if (BLOG_COVER_RE.test(post.cover_path)) {
        cover = toSitePath(await store.fromStorage({ bucket: 'site-assets', path: post.cover_path })) ?? '';
      } else {
        options.warn(`odrzucono okładkę wpisu ${post.slug}: niepoprawna ścieżka`);
      }
    }
    posts.push({ ...post, cover_path: cover, body_md: await rewriteMarkdownImages(post.body_md, resolve) });
  }

  const newsletters = [];
  const newsletterAssets = new Map<string, SiteNewsletterAsset>();
  for (const issue of raw.newsletters) {
    const html = await rewriteNewsletterHtml(issue.html_web, resolve);
    for (const match of html.matchAll(/\/n\/a\/([0-9a-f]{64})\.(png|jpg|webp|gif)/g)) {
      const [, sha256, ext] = match as unknown as [string, string, SiteNewsletterAsset['ext']];
      newsletterAssets.set(`${sha256}.${ext}`, { sha256, ext, path: `assets/${sha256}.${ext}` });
    }
    newsletters.push({ ...issue, html_web: html });
  }

  return {
    snapshot: { ...raw, identity, staff, posts, newsletters, newsletter_assets: [...newsletterAssets.values()] },
    assets: store.count,
  };
}

/** Zapis snapshot.json (atomowo: plik tymczasowy + rename); zwraca sha256 zapisanych bajtów. */
export function writeSnapshotFile(outDir: string, snapshot: SiteSnapshot): string {
  const bytes = Buffer.from(`${JSON.stringify(snapshot)}\n`, 'utf8');
  const target = join(outDir, 'snapshot.json');
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, bytes, { mode: 0o644 });
  renameSync(tmp, target);
  return createHash('sha256').update(bytes).digest('hex');
}

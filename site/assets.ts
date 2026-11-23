// Zasoby strony statycznej: rozpoznanie obrazu po magic bytes, usuwanie metadanych JPEG,
// mapowanie URL-i publicznego Storage na buckety i przepisywanie referencji w treści.
// Zasada prywatności: strona posła nie ładuje nic z obcych hostów - obraz spoza dozwolonych
// bucketów jest usuwany z treści (a nie linkowany), bo zdradzałby IP odwiedzających.

import type { AssetExtension } from '../src/lib/siteSnapshot';

/** Publiczne buckety, z których generator kopiuje obrazy (wszystko inne odrzucane). */
export const ALLOWED_BUCKETS = ['site-assets', 'avatars', 'newsletter-assets'] as const;
export type AllowedBucket = (typeof ALLOWED_BUCKETS)[number];

export interface StorageRef {
  bucket: AllowedBucket;
  /** Ścieżka obiektu w buckecie (bez wiodącego /), np. homepage/1763740800000.jpg. */
  path: string;
}

/** Lokalna referencja zasobu po przepisaniu. */
export interface LocalAsset {
  sha256: string;
  ext: AssetExtension;
}

export const SITE_ASSET_URL_RE = /^\/assets\/([0-9a-f]{64})\.(png|jpg|webp|gif)$/;
export const NEWSLETTER_ASSET_URL_RE = /^\/n\/a\/([0-9a-f]{64})\.(png|jpg|webp|gif)$/;

const STORAGE_PUBLIC_PREFIX = '/storage/v1/object/public/';
const OBJECT_PATH_RE = /^[A-Za-z0-9._~@=+-]+(?:\/[A-Za-z0-9._~@=+-]+)*$/;

/**
 * URL publicznego obiektu Storage (`https://<dowolny host>/storage/v1/object/public/<bucket>/<path>`
 * albo sama ścieżka) -> bucket i ścieżka; null dla innych adresów i bucketów spoza listy.
 * Host jest ignorowany: plik i tak pobieramy wewnętrznym adresem Storage (`--storage-url`).
 */
export function parseStorageUrl(raw: string): StorageRef | null {
  let pathname: string;
  try {
    const url = new URL(raw, 'http://local.invalid');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.search || url.hash) return null;
    pathname = url.pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(STORAGE_PUBLIC_PREFIX)) return null;
  const rest = pathname.slice(STORAGE_PUBLIC_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const bucket = rest.slice(0, slash);
  let path: string;
  try {
    path = decodeURIComponent(rest.slice(slash + 1));
  } catch {
    return null;
  }
  if (!(ALLOWED_BUCKETS as readonly string[]).includes(bucket)) return null;
  if (!OBJECT_PATH_RE.test(path) || path.split('/').some((part) => part === '.' || part === '..')) return null;
  return { bucket: bucket as AllowedBucket, path };
}

/** Typ obrazu po magic bytes (nie po rozszerzeniu ani Content-Type). */
export function detectImageType(bytes: Uint8Array): AssetExtension | null {
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (bytes.length >= 8 && starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (bytes.length >= 3 && starts([0xff, 0xd8, 0xff])) return 'jpg';
  if (bytes.length >= 12 && starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (bytes.length >= 6 && (starts([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || starts([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) {
    return 'gif';
  }
  return null;
}

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, Math.min(start + length, bytes.length)));

/**
 * Usuwa z JPEG segmenty metadanych przed obrazem (SOS): EXIF/XMP (APP1), IPTC/Photoshop (APP13),
 * komentarze (COM) i pozostałe APPn. Zostają tylko segmenty techniczne potrzebne do poprawnych
 * kolorów: APP0 JFIF/JFXX, APP2 ICC_PROFILE (zdjęcia z telefonów w Display P3) i APP14 Adobe
 * (transformacja kolorów CMYK/YCCK). Dane obrazu (od SOS) kopiowane bez zmian.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (detectImageType(bytes) !== 'jpg') throw new ImageError('to nie jest JPEG');
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let pos = 2;
  for (;;) {
    if (pos + 4 > bytes.length) throw new ImageError('JPEG ucięty przed danymi obrazu');
    if (bytes[pos] !== 0xff) throw new ImageError('JPEG: niepoprawny znacznik segmentu');
    const marker = bytes[pos + 1];
    if (marker === 0xff) {
      // Bajt wypełnienia przed znacznikiem.
      pos += 1;
      continue;
    }
    if (marker === 0xda) {
      // SOS: dalej dane skompresowane (i ewentualne kolejne skany) - bez zmian do końca pliku.
      parts.push(bytes.subarray(pos));
      break;
    }
    if (marker === 0xd9) throw new ImageError('JPEG bez danych obrazu');
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    const length = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (length < 2 || pos + 2 + length > bytes.length) throw new ImageError('JPEG: niepoprawna długość segmentu');
    const end = pos + 2 + length;
    const payload = pos + 4;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keep =
      !isApp && marker !== 0xfe
        ? true
        : (marker === 0xe0 && (ascii(bytes, payload, 5) === 'JFIF\0' || ascii(bytes, payload, 5) === 'JFXX\0')) ||
          (marker === 0xe2 && ascii(bytes, payload, 12) === 'ICC_PROFILE\0') ||
          (marker === 0xee && ascii(bytes, payload, 5) === 'Adobe');
    if (keep) parts.push(bytes.subarray(pos, end));
    pos = end;
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Rozwiązanie URL-a obrazu na zasób lokalny; null = obraz odrzucony (usuwany z treści). */
export type AssetResolver = (url: string) => Promise<LocalAsset | null>;

const MD_INLINE_IMAGE_RE = /!\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>\n]*>|[^\s)]+)(\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;

/**
 * Obrazy Markdown `![alt](url "tytuł")`: URL Storage z dozwolonego bucketu -> /assets/<sha256>.<ext>,
 * każdy inny obraz usuwany z treści. Obrazy referencyjne i inne konstrukcje filtruje dodatkowo
 * renderer (PublicBlog: tylko /assets/...).
 */
export async function rewriteMarkdownImages(markdown: string, resolve: AssetResolver): Promise<string> {
  const matches = [...markdown.matchAll(MD_INLINE_IMAGE_RE)];
  if (matches.length === 0) return markdown;
  let out = '';
  let last = 0;
  for (const match of matches) {
    const [whole, alt, rawUrl, title = ''] = match;
    const url = rawUrl.startsWith('<') ? rawUrl.slice(1, -1) : rawUrl;
    out += markdown.slice(last, match.index);
    if (SITE_ASSET_URL_RE.test(url)) {
      out += whole;
    } else {
      const asset = await resolve(url);
      if (asset) out += `![${alt}](/assets/${asset.sha256}.${asset.ext}${title})`;
    }
    last = match.index + whole.length;
  }
  return out + markdown.slice(last);
}

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_ATTR_RE = /\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i;
const SRCSET_ATTR_RE = /\ssrcset\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const BACKGROUND_ATTR_RE = /\sbackground\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const NEWSLETTER_FONT_RE = /^(?:https?:\/\/[^/]+)?(\/fonts\/newsletter\/[A-Za-z0-9._-]+\.(?:woff2|woff))$/i;

const decodeAttr = (value: string) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/**
 * Wersja online newslettera (html_web): obrazy -> /n/a/<sha256>.<ext>, fonty szablonu ->
 * /fonts/newsletter/* (kopia na stronie). Obraz bez lokalnego odpowiednika: znacznik <img> usuwany,
 * atrybut background / url() w CSS czyszczony. Linki (<a href>) bez zmian - pilnuje ich strażnik.
 */
export async function rewriteNewsletterHtml(html: string, resolve: AssetResolver): Promise<string> {
  const local = async (raw: string): Promise<string | null> => {
    const url = decodeAttr(raw.trim());
    if (NEWSLETTER_ASSET_URL_RE.test(url)) return url;
    const asset = await resolve(url);
    return asset ? `/n/a/${asset.sha256}.${asset.ext}` : null;
  };

  let out = '';
  let last = 0;
  for (const match of html.matchAll(IMG_TAG_RE)) {
    let tag = match[0].replace(SRCSET_ATTR_RE, '');
    const src = SRC_ATTR_RE.exec(tag);
    const value = src ? (src[2] ?? src[3] ?? src[4] ?? '') : '';
    const replacement = value ? await local(value) : null;
    tag = replacement && src ? tag.replace(src[0], ` src="${replacement}"`) : '';
    out += html.slice(last, match.index) + tag;
    last = match.index + match[0].length;
  }
  out += html.slice(last);

  out = await replaceAsync(out, BACKGROUND_ATTR_RE, async (_whole, _quote, dq, sq, bare) => {
    const replacement = await local(dq ?? sq ?? bare ?? '');
    return replacement ? ` background="${replacement}"` : '';
  });
  return replaceAsync(out, CSS_URL_RE, async (whole, quote: string, raw: string) => {
    const value = decodeAttr(raw.trim());
    if (value.startsWith('data:')) return whole;
    const font = NEWSLETTER_FONT_RE.exec(value);
    if (font) return `url(${quote}${font[1]}${quote})`;
    const replacement = await local(value);
    return replacement ? `url(${quote}${replacement}${quote})` : `url(${quote}${quote})`;
  });
}

async function replaceAsync(
  input: string,
  pattern: RegExp,
  replacer: (...groups: string[]) => Promise<string>,
): Promise<string> {
  let out = '';
  let last = 0;
  for (const match of input.matchAll(pattern)) {
    out += input.slice(last, match.index) + (await replacer(...(match as unknown as string[])));
    last = match.index + match[0].length;
  }
  return out + input.slice(last);
}

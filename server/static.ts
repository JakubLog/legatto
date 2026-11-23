// Pliki builda SPA (dist/) jak warstwa „filesystem” Vercela: istniejący plik ma pierwszeństwo przed
// rewrites. /assets/* (nazwy z hashem) - cache na rok; reszta (index.html, sw.js, manifest) - zawsze
// rewalidowana. Indeks plików powstaje przy starcie (obraz jest read-only), więc ścieżka żądania nigdy
// nie trafia do systemu plików bez sprawdzenia w indeksie.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.geojson': 'application/geo+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.map': 'application/json',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'public, max-age=0, must-revalidate';

interface StaticFile {
  absolute: string;
  size: number;
  etag: string;
  type: string;
  /** Treść po transformacji (index.html, manifest) - serwowana z pamięci. */
  body: Buffer | null;
}

/** Podmiana treści wybranych plików przy starcie (tytuł instancji). Klucz: ścieżka URL. */
export type StaticTransforms = Record<string, (content: string) => string>;

export class StaticFiles {
  private readonly files = new Map<string, StaticFile>();

  constructor(root: string, transforms: StaticTransforms = {}) {
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(absolute);
          continue;
        }
        if (!entry.isFile()) continue;
        const urlPath = `/${path.relative(root, absolute).split(path.sep).join('/')}`;
        const transform = transforms[urlPath];
        const body = transform ? Buffer.from(transform(fs.readFileSync(absolute, 'utf8')), 'utf8') : null;
        const stat = fs.statSync(absolute);
        const etag = body
          ? `"${createHash('sha1').update(body).digest('base64url')}"`
          : `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
        this.files.set(urlPath, {
          absolute,
          size: body ? body.length : stat.size,
          etag,
          type: MIME[path.extname(entry.name).toLowerCase()] ?? 'application/octet-stream',
          body,
        });
      }
    };
    walk(root);
  }

  /** Ścieżka URL pliku (`/` → `/index.html`) albo null. */
  resolve(pathname: string): string | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    const key = decoded.endsWith('/') ? `${decoded}index.html` : decoded;
    return this.files.has(key) ? key : null;
  }

  serve(req: IncomingMessage, res: ServerResponse, key: string): void {
    const file = this.files.get(key);
    if (!file) throw new Error(`static: brak ${key} w indeksie`);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.end();
      return;
    }
    res.setHeader('Content-Type', file.type);
    res.setHeader('Cache-Control', key.startsWith('/assets/') ? IMMUTABLE : REVALIDATE);
    res.setHeader('ETag', file.etag);
    if (req.headers['if-none-match'] === file.etag) {
      res.statusCode = 304;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Length', file.size);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    if (file.body) {
      res.end(file.body);
      return;
    }
    const stream = fs.createReadStream(file.absolute);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}

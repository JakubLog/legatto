// VercelRequest/VercelResponse na zwykłym node:http - ta sama semantyka co helpery @vercel/node
// (serverless-functions/helpers.ts): req.query, req.cookies, req.body (leniwie, wg Content-Type),
// res.status/json/send/redirect. Strumieniowanie (res.write, flushHeaders - SSE PoliAI) to natywny
// ServerResponse. Używa go server/app.ts (VPS) i serwer deweloperski Vite.

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Limit treści żądania funkcji na Vercelu (4.5 MB). */
export const MAX_BODY_BYTES = 4.5 * 1024 * 1024;

export class BodyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Czyta treść żądania z limitem; przekroczenie (deklarowane albo faktyczne) = 413. */
export async function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new BodyError(413, 'FUNCTION_PAYLOAD_TOO_LARGE');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new BodyError(413, 'FUNCTION_PAYLOAD_TOO_LARGE');
    chunks.push(buf);
  }
  return Buffer.concat(chunks, size);
}

/** Po odczycie treści handler nadal może czytać req jako strumień (jak restoreBody na Vercelu). */
function restoreBody(req: IncomingMessage, body: Buffer): void {
  const replay = new PassThrough();
  const originalOn = req.on.bind(req);
  req.read = replay.read.bind(replay);
  const on = ((event: string, listener: (...args: unknown[]) => void) =>
    event === 'data' || event === 'end' ? replay.on(event, listener) : originalOn(event, listener)) as IncomingMessage['on'];
  req.on = on;
  req.addListener = on;
  replay.end(body);
}

function mediaType(contentType: string | undefined): string {
  if (!contentType) return 'text/plain';
  return contentType.split(';')[0].trim().toLowerCase();
}

function parseBody(body: Buffer, contentType: string | undefined): unknown {
  const type = mediaType(contentType);
  if (type === 'application/json') {
    const text = body.toString();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new BodyError(400, 'Invalid JSON');
    }
  }
  if (type === 'application/octet-stream') return body;
  if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(groupParams(new URLSearchParams(body.toString())));
  if (type === 'text/plain') return body.toString();
  return undefined;
}

/** URLSearchParams → obiekt jak querystring.parse (powtórzony klucz = tablica). */
function groupParams(params: URLSearchParams): Map<string, string | string[]> {
  const out = new Map<string, string | string[]>();
  for (const [key, value] of params) {
    const prev = out.get(key);
    out.set(key, prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value]);
  }
  return out;
}

function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of (Array.isArray(header) ? header.join(';') : header).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

function setLazyProp<T>(target: object, prop: string, getter: () => T): void {
  Object.defineProperty(target, prop, {
    configurable: true,
    enumerable: true,
    get: () => {
      const value = getter();
      Object.defineProperty(target, prop, { configurable: true, enumerable: true, writable: true, value });
      return value;
    },
    set: (value: T) => {
      Object.defineProperty(target, prop, { configurable: true, enumerable: true, writable: true, value });
    },
  });
}

function withCharset(type: string): string {
  const [media, ...params] = type.split(';').map((p) => p.trim());
  const rest = params.filter((p) => !/^charset=/i.test(p));
  return [media, ...rest, 'charset=utf-8'].join('; ');
}

function weakEtag(body: Buffer): string {
  const hash = createHash('sha1').update(body).digest('base64').slice(0, 27);
  return `W/"${body.length.toString(16)}-${hash}"`;
}

function send(req: IncomingMessage, res: ServerResponse, body: unknown): void {
  let chunk: string | Buffer | undefined;
  if (typeof body === 'string') {
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'text/html');
    chunk = body;
  } else if (Buffer.isBuffer(body)) {
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/octet-stream');
    chunk = body;
  } else if (body === null || body === undefined) {
    chunk = body === null ? '' : undefined;
  } else if (typeof body === 'object' || typeof body === 'number' || typeof body === 'boolean') {
    sendJson(req, res, body);
    return;
  } else {
    throw new Error('`body` is not a valid string, object, boolean, number, Stream, or Buffer');
  }
  if (typeof chunk === 'string') {
    const type = res.getHeader('content-type');
    if (typeof type === 'string') res.setHeader('content-type', withCharset(type));
    chunk = Buffer.from(chunk, 'utf8');
  }
  if (chunk !== undefined) {
    res.setHeader('content-length', chunk.length);
    if (!res.getHeader('etag')) res.setHeader('etag', weakEtag(chunk));
  }
  if (res.statusCode === 204 || res.statusCode === 304) {
    res.removeHeader('Content-Type');
    res.removeHeader('Content-Length');
    res.removeHeader('Transfer-Encoding');
    chunk = undefined;
  }
  if (req.method === 'HEAD' || chunk === undefined) res.end();
  else res.end(chunk);
}

function sendJson(req: IncomingMessage, res: ServerResponse, value: unknown): void {
  if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
  send(req, res, JSON.stringify(value));
}

export interface InvocationTarget {
  /** Ścieżka i query widziane przez handler (po rewrite). */
  url: string;
  query: URLSearchParams;
}

/**
 * Dokłada helpery Vercela do żądania i odpowiedzi. Treść jest już odczytana (`body`), żeby limit
 * 4.5 MB i błąd JSON zadziałały przed handlerem, a req nadal da się czytać jako strumień.
 */
export function toVercel(
  req: IncomingMessage,
  res: ServerResponse,
  target: InvocationTarget,
  body: Buffer,
): { req: VercelRequest; res: VercelResponse } {
  req.url = target.url;
  const contentType = req.headers['content-type'];
  restoreBody(req, body);
  setLazyProp(req, 'query', () => Object.fromEntries(groupParams(target.query)));
  setLazyProp(req, 'cookies', () => parseCookies(req.headers.cookie));
  setLazyProp(req, 'body', () => (contentType === undefined ? '' : parseBody(body, contentType)));

  const vres = res as VercelResponse;
  vres.status = (code: number) => {
    res.statusCode = code;
    return vres;
  };
  vres.send = (value: unknown) => {
    send(req, res, value);
    return vres;
  };
  vres.json = (value: unknown) => {
    sendJson(req, res, value);
    return vres;
  };
  vres.redirect = ((statusOrUrl: number | string, url?: string) => {
    const [code, location] = typeof statusOrUrl === 'string' ? [307, statusOrUrl] : [statusOrUrl, url];
    if (typeof code !== 'number' || typeof location !== 'string') {
      throw new Error('Invalid redirect arguments: res.redirect(url) or res.redirect(status, url).');
    }
    res.writeHead(code, { Location: location }).end();
    return vres;
  }) as VercelResponse['redirect'];
  return { req: req as VercelRequest, res: vres };
}

/** Błąd treści (413 / 400 Invalid JSON) w formie odpowiedzi Vercela. */
export function sendBodyError(res: ServerResponse, err: BodyError): void {
  res.statusCode = err.status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(`${err.message}\n`);
}

// Minimalny klient HTTPS dla intake (bez zależności): proxy egress z HTTPS_PROXY/NO_PROXY
// (https.Agent proxyEnv, Node ≥ 24.5) i opcjonalny własny zestaw CA, który ZASTĘPUJE systemowy
// trust store (fail-closed: brak pliku = błąd konfiguracji, bez powrotu do systemowych CA).
// http:// dozwolone wyłącznie dla adresów pętli zwrotnej (testy z atrapą API).

import http from 'node:http';
import https from 'node:https';

export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface HttpClientOptions {
  /** PEM CA zastępujący systemowy trust store (np. /etc/legatto/ca/cloudflare-api.pem). */
  ca?: string;
  /** Zmienne proxy (domyślnie process.env: HTTPS_PROXY, NO_PROXY). */
  proxyEnv?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

type AgentWithProxy = https.AgentOptions & { proxyEnv?: NodeJS.ProcessEnv };

export class HttpClient {
  private readonly httpsAgent: https.Agent;
  private readonly timeoutMs: number;
  private readonly maxBodyBytes: number;

  constructor(options: HttpClientOptions = {}) {
    const agentOptions: AgentWithProxy = {
      keepAlive: false,
      proxyEnv: options.proxyEnv ?? process.env,
      ...(options.ca ? { ca: options.ca } : {}),
    };
    this.httpsAgent = new https.Agent(agentOptions);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxBodyBytes = options.maxBodyBytes ?? 32 * 1024 * 1024;
  }

  request(
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<HttpResponse> {
    const target = new URL(url);
    let transport: typeof http | typeof https;
    if (target.protocol === 'https:') {
      transport = https;
    } else if (target.protocol === 'http:' && LOOPBACK_HOSTS.includes(target.hostname)) {
      transport = http;
    } else {
      return Promise.reject(new Error(`niedozwolony adres: ${target.protocol}//${target.host}`));
    }
    const payload = body === undefined ? undefined : Buffer.from(body, 'utf8');
    const { promise, resolve, reject } = Promise.withResolvers<HttpResponse>();
    const req = transport.request(
      target,
      {
        method,
        agent: transport === https ? this.httpsAgent : undefined,
        headers: {
          ...headers,
          ...(payload ? { 'Content-Length': String(payload.length) } : {}),
        },
        timeout: this.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > this.maxBodyBytes) {
            req.destroy(new Error('odpowiedź za duża'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('przekroczony czas żądania')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
    return promise;
  }
}

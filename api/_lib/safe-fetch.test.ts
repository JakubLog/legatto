import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { proxyFor, safeFetch, SsrfError } from './safe-fetch';

describe('proxyFor', () => {
  const env = { HTTPS_PROXY: 'http://egress-app:4750', NO_PROXY: 'api-gw,db,localhost,.internal' };

  it('host zewnętrzny idzie przez proxy, NO_PROXY pomija', () => {
    expect(proxyFor('calendar.google.com', env)?.host).toBe('egress-app:4750');
    expect(proxyFor('api-gw', env)).toBeNull();
    expect(proxyFor('x.internal', env)).toBeNull();
    expect(proxyFor('calendar.google.com', {})).toBeNull();
  });

  it('tylko proxy http://', () => {
    expect(() => proxyFor('a.pl', { HTTPS_PROXY: 'socks5://p:1' })).toThrow();
  });
});

describe('safeFetch przez proxy CONNECT', () => {
  let proxy: http.Server | null = null;
  const saved = process.env.HTTPS_PROXY;

  afterEach(() => {
    proxy?.close();
    proxy = null;
    if (saved === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = saved;
  });

  it('odmowa proxy (host spoza allowlisty) = SsrfError, cel z portem 443', async () => {
    const targets: string[] = [];
    proxy = http.createServer();
    proxy.on('connect', (req, socket) => {
      targets.push(req.url ?? '');
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
    await new Promise<void>((resolve) => proxy!.listen(0, '127.0.0.1', resolve));
    process.env.HTTPS_PROXY = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    await expect(safeFetch('https://calendar.example.com/a.ics', { timeoutMs: 5_000 })).rejects.toBeInstanceOf(SsrfError);
    expect(targets).toEqual(['calendar.example.com:443']);
  });

  it('lista hostów i literalne IP prywatne odrzucane przed połączeniem', async () => {
    await expect(safeFetch('https://inny.example.com/a.ics', { allowedHosts: ['calendar.example.com'] })).rejects.toBeInstanceOf(SsrfError);
    await expect(safeFetch('https://10.0.0.1/a.ics')).rejects.toBeInstanceOf(SsrfError);
    await expect(safeFetch('http://calendar.example.com/a.ics')).rejects.toBeInstanceOf(SsrfError);
  });
});

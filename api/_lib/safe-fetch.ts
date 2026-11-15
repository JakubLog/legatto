import dns from 'node:dns';
import net from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';

// ===== SSRF GUARD =====
//
// Pobieranie URL-i podanych przez uzytkownika (np. zrodla ICS) musi byc chronione
// przed SSRF: tylko https na porcie 443 (funkcja nie sluzy jako klient do dowolnych
// portow/uslug), blokujemy adresy loopback, prywatne, link-local, zastrzezone
// i endpoint metadanych chmury (IPv4 i IPv6, rowniez IPv4 osadzone w IPv6). Literalne IP
// w URL sprawdzamy przed polaczeniem, a nazwy hostow sa walidowane w `lookup` wywolywanym
// przez gniazdo w momencie laczenia - polaczenie idzie dokladnie na zwalidowany adres
// (brak okna TOCTOU / DNS rebinding). Kazdy redirect jest walidowany ponownie (takze
// schemat i port), a odpowiedz ma limit rozmiaru.

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

// ----- IPv4 -----

function ipv4ToLong(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function isPrivateIPv4Long(n: number): boolean {
  const inRange = (base: string, bits: number) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((ipv4ToLong(base) & mask) >>> 0);
  };
  return (
    inRange('0.0.0.0', 8) ||        // "this" network
    inRange('10.0.0.0', 8) ||       // private
    inRange('100.64.0.0', 10) ||    // CGN
    inRange('127.0.0.0', 8) ||      // loopback
    inRange('169.254.0.0', 16) ||   // link-local (w tym 169.254.169.254 metadata)
    inRange('172.16.0.0', 12) ||    // private
    inRange('192.0.0.0', 24) ||     // IETF protocol
    inRange('192.0.2.0', 24) ||     // dokumentacja (TEST-NET-1)
    inRange('192.168.0.0', 16) ||   // private
    inRange('198.18.0.0', 15) ||    // benchmarking
    inRange('198.51.100.0', 24) ||  // dokumentacja (TEST-NET-2)
    inRange('203.0.113.0', 24) ||   // dokumentacja (TEST-NET-3)
    inRange('224.0.0.0', 4) ||      // multicast
    inRange('240.0.0.0', 4)         // reserved + broadcast
  );
}

// ----- IPv6 -----

/** Parsuje adres IPv6 (rowniez z ogonem kropkowym i zone id) do 16 bajtow; null = niepoprawny. */
function parseIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase().split('%')[0]; // odetnij zone id (fe80::1%eth0)
  const lastColon = addr.lastIndexOf(':');
  if (lastColon === -1) return null;
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    // ::ffff:a.b.c.d -> ::ffff:XXXX:XXXX
    if (!net.isIPv4(tail)) return null;
    const n = ipv4ToLong(tail);
    addr = `${addr.slice(0, lastColon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];

  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push(v >> 8, v & 0xff);
  }
  return bytes;
}

function isBlockedIPv6(ip: string): boolean {
  const b = parseIPv6(ip);
  if (!b) return true; // nieparsowalny = blokuj
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  const v4At = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

  // IPv4 osadzone w IPv6 - decyduje osadzony adres IPv4:
  // ::/96 (IPv4-compatible, w tym :: i ::1), ::ffff:0:0/96 (IPv4-mapped),
  // ::ffff:0:0:0/96 (IPv4-translated), 64:ff9b::/96 (NAT64), 2002::/16 (6to4).
  if (zero(0, 10) && ((b[10] === 0 && b[11] === 0) || (b[10] === 0xff && b[11] === 0xff))) {
    return isPrivateIPv4Long(v4At(12));
  }
  if (zero(0, 8) && b[8] === 0xff && b[9] === 0xff && b[10] === 0 && b[11] === 0) {
    return isPrivateIPv4Long(v4At(12));
  }
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(4, 12)) {
    return isPrivateIPv4Long(v4At(12));
  }
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateIPv4Long(v4At(2));

  // Dopuszczamy tylko global unicast 2000::/3. Poza nim m.in.: 100::/64 (discard),
  // 64:ff9b:1::/48 (NAT64 lokalny), fc00::/7 (ULA), fe80::/10 (link-local),
  // fec0::/10 (site-local), ff00::/8 (multicast).
  if ((b[0] & 0xe0) !== 0x20) return true;
  // 2001::/23 (IETF: Teredo, benchmarking, ORCHID), 2001:db8::/32 i 3fff::/20 (dokumentacja).
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] < 0x02) return true;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true;
  if (b[0] === 0x3f && b[1] === 0xff && b[2] < 0x10) return true;
  return false;
}

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4Long(ipv4ToLong(ip));
  if (net.isIPv6(ip)) return isBlockedIPv6(ip);
  return true; // nieznany format = blokuj
}

// ----- Polaczenie -----

/**
 * `lookup` dla gniazda: rozwiazuje nazwe i odrzuca polaczenie, jesli KTORYKOLWIEK
 * adres jest zablokowany. Gniazdo laczy sie wylacznie z adresami zwroconymi tutaj,
 * wiec walidacja i polaczenie dotycza tego samego rozwiazania DNS.
 */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  const allOptions: dns.LookupAllOptions = { ...options, all: true };
  dns.lookup(hostname, allOptions, (err, addresses) => {
    if (err) return callback(err, []);
    if (addresses.length === 0) return callback(new SsrfError('Brak adresow DNS dla hosta'), []);
    if (addresses.some((a) => isBlockedIp(a.address))) {
      return callback(new SsrfError('Host wskazuje na prywatny/zastrzezony adres IP'), []);
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
};

function assertPublicUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('Niepoprawny URL');
  }
  // URL normalizuje domyslny port: dla https '' = 443.
  if (url.protocol !== 'https:' || url.port !== '') {
    throw new SsrfError('Dozwolony tylko adres https na porcie 443');
  }

  // Literalne IP nie przechodzi przez `lookup` - sprawdz bezposrednio.
  // Nazwy hostow sprawdza guardedLookup w momencie laczenia.
  const hostname = url.hostname.replace(/^\[|\]$/g, ''); // strip [] z IPv6
  if (net.isIP(hostname) && isBlockedIp(hostname)) {
    throw new SsrfError('Adres IP jest prywatny/zastrzezony');
  }
  return url;
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  /** Limit czasu calej operacji (wszystkie przekierowania + odczyt tresci). */
  timeoutMs?: number;
  maxRedirects?: number;
  /** Maksymalny rozmiar tresci odpowiedzi w bajtach; przekroczenie przerywa pobieranie. */
  maxBytes?: number;
}

export interface SafeFetchResponse {
  status: number;
  ok: boolean;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

function requestOnce(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  maxBytes: number,
): Promise<SafeFetchResponse> {
  return new Promise((resolve, reject) => {
    const timeoutError = () => new Error('Przekroczono limit czasu pobierania');
    const req = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        // identity: limit bajtow dotyczy faktycznie odbieranej tresci (bez dekompresji).
        headers: { ...headers, 'accept-encoding': 'identity' },
        lookup: guardedLookup,
        agent: false,
        signal,
      },
      (res) => {
        const status = res.statusCode ?? 0;

        // Przekierowanie: tresc pomijamy, cel waliduje petla w safeFetch.
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ status, ok: false, headers: res.headers, body: Buffer.alloc(0) });
          return;
        }

        const tooLargeMessage = `Odpowiedz przekracza limit ${maxBytes} bajtow`;
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
          reject(new Error(tooLargeMessage));
          res.destroy();
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy(new Error(tooLargeMessage));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({ status, ok: status >= 200 && status < 300, headers: res.headers, body: Buffer.concat(chunks, size) });
        });
        res.on('error', (err) => reject(signal.aborted ? timeoutError() : err));
        res.on('close', () => {
          if (!res.complete) reject(signal.aborted ? timeoutError() : new Error('Polaczenie przerwane'));
        });
      },
    );
    req.on('error', (err) => reject(signal.aborted ? timeoutError() : err));
    req.end();
  });
}

/**
 * Pobieranie odporne na SSRF: waliduje URL i kazdy redirect wzgledem blokad IP,
 * przypina polaczenie do zwalidowanych adresow, wymusza https:443, limituje liczbe
 * przekierowan, czas i rozmiar tresci. Zwraca finalna odpowiedz z buforowana trescia.
 */
export async function safeFetch(inputUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const { headers = {}, timeoutMs = 20_000, maxRedirects = 5, maxBytes = 5 * 1024 * 1024 } = opts;
  const signal = AbortSignal.timeout(timeoutMs);
  let currentUrl = inputUrl;

  for (let i = 0; i <= maxRedirects; i++) {
    const url = assertPublicUrl(currentUrl);
    const resp = await requestOnce(url, headers, signal, maxBytes);

    // 3xx z Location - waliduj cel i podazaj recznie
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.location;
      if (!location) return resp;
      currentUrl = new URL(location, url).toString();
      continue;
    }
    return resp;
  }
  throw new SsrfError('Przekroczono limit przekierowan');
}

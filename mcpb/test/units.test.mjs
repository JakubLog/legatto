import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readConfig, parseOfficeUrl } from '../server/lib/config.mjs';
import { LegattoError, describeNetworkError } from '../server/lib/errors.mjs';
import { CODE_VERIFIER_RE, codeChallengeS256, createCodeVerifier, createState } from '../server/lib/pkce.mjs';
import { SseParser, readSseEvents } from '../server/lib/sse.mjs';
import { TokenStore, defaultDataDir } from '../server/lib/token-store.mjs';

describe('PKCE', () => {
  it('liczy code_challenge S256 zgodnie z wektorem RFC 7636 (dodatek B)', () => {
    expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('generuje verifier zgodny z RFC 7636 §4.1 i challenge akceptowany przez serwer biura', () => {
    const verifier = createCodeVerifier();
    expect(verifier).toMatch(CODE_VERIFIER_RE);
    expect(verifier).toHaveLength(43);
    // api/_lib/oauth.ts: CODE_CHALLENGE_S256_RE
    expect(codeChallengeS256(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createCodeVerifier()).not.toBe(verifier);
    expect(createState()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('odrzuca verifier spoza RFC 7636', () => {
    expect(() => codeChallengeS256('za-krotki')).toThrow(TypeError);
    expect(() => codeChallengeS256(`${'a'.repeat(42)}+`)).toThrow(TypeError);
  });
});

describe('parser SSE', () => {
  /** @param {string[]} chunks */
  function parse(chunks) {
    const events = [];
    const parser = new SseParser((e) => events.push(e));
    for (const chunk of chunks) parser.push(chunk);
    parser.end();
    return events;
  }

  it('składa dane z wielu linii, pomija komentarze i obsługuje nazwy zdarzeń', () => {
    const events = parse([': ping\n\nevent: message\ndata: {"a":\ndata: 1}\nid: 5\n\nevent: other\ndata:x\n\n']);
    expect(events).toEqual([
      { event: 'message', data: '{"a":\n1}', id: '5' },
      { event: 'other', data: 'x', id: '5' },
    ]);
  });

  it('obsługuje CRLF, samo CR i podział fragmentów w dowolnym miejscu (także między CR a LF)', () => {
    const text = 'data: jeden\r\n\r\ndata: dwa\r\rdata: trzy\n\n';
    const expected = [
      { event: 'message', data: 'jeden', id: '' },
      { event: 'message', data: 'dwa', id: '' },
      { event: 'message', data: 'trzy', id: '' },
    ];
    for (let split = 1; split < text.length; split += 1) {
      expect(parse([text.slice(0, split), text.slice(split)])).toEqual(expected);
    }
    expect(parse(text.split(''))).toEqual(expected);
  });

  it('nie wysyła zdarzeń bez danych ani niedokończonego zdarzenia na końcu strumienia', () => {
    expect(parse(['event: x\n\nid: 3\n\ndata: koniec'])).toEqual([]);
    expect(parse(['data\n\n'])).toEqual([{ event: 'message', data: '', id: '' }]);
  });

  it('dekoduje UTF-8 podzielony między fragmentami bajtów i usuwa BOM', async () => {
    const bytes = new TextEncoder().encode('\uFEFFdata: zażółć gęślą jaźń\n\n');
    async function* body() {
      for (const b of bytes) yield new Uint8Array([b]);
    }
    const events = [];
    for await (const e of readSseEvents(body())) events.push(e);
    expect(events).toEqual([{ event: 'message', data: 'zażółć gęślą jaźń', id: '' }]);
  });

  it('odrzuca zbyt duże zdarzenie', () => {
    const parser = new SseParser(() => {}, 10);
    expect(() => parser.push('data: 0123456789abc\n')).toThrow(/Zbyt duże/);
  });
});

describe('konfiguracja', () => {
  it('normalizuje adres biura', () => {
    expect(parseOfficeUrl('https://app.biuro.pl')).toBe('https://app.biuro.pl');
    expect(parseOfficeUrl('https://app.biuro.pl/')).toBe('https://app.biuro.pl');
    expect(parseOfficeUrl('https://app.biuro.pl/api/mcp')).toBe('https://app.biuro.pl');
    expect(parseOfficeUrl('app.biuro.pl')).toBe('https://app.biuro.pl');
    expect(parseOfficeUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  });

  it('odrzuca niebezpieczne albo błędne adresy', () => {
    for (const bad of ['', 'http://app.biuro.pl', 'https://u:p@app.biuro.pl', 'https://app.biuro.pl/biuro/admin', 'https://app.biuro.pl/?x=1', 'ftp://x']) {
      expect(() => parseOfficeUrl(bad)).toThrow(LegattoError);
    }
  });

  it('wybiera tryb OAuth albo token i ignoruje niepodstawione placeholdery', () => {
    const oauth = readConfig({
      LEGATTO_OFFICE_URL: 'https://app.biuro.pl',
      LEGATTO_CLIENT_ID: 'oc_1',
      LEGATTO_CLIENT_SECRET: 'sekret',
      LEGATTO_MCP_TOKEN: '${user_config.mcp_token}',
    });
    expect(oauth).toMatchObject({ mode: 'oauth', mcpUrl: 'https://app.biuro.pl/api/mcp', host: 'app.biuro.pl' });

    const token = readConfig({ LEGATTO_OFFICE_URL: 'https://app.biuro.pl', LEGATTO_MCP_TOKEN: 'epm_abcdefghijklmnop' });
    expect(token.mode).toBe('token');

    expect(() => readConfig({ LEGATTO_OFFICE_URL: 'https://app.biuro.pl', LEGATTO_CLIENT_ID: '${user_config.client_id}' })).toThrow(
      /Client ID i Client Secret/,
    );
    expect(() => readConfig({ LEGATTO_OFFICE_URL: 'https://app.biuro.pl', LEGATTO_MCP_TOKEN: 'abc' })).toThrow(/epm_/);
  });

  it('wybiera katalog danych zależnie od systemu', () => {
    expect(defaultDataDir({}, 'darwin', '/Users/a')).toBe('/Users/a/Library/Application Support/Legatto MCP');
    expect(defaultDataDir({ XDG_CONFIG_HOME: '/x' }, 'linux', '/home/a')).toBe('/x/legatto-mcp');
    expect(defaultDataDir({ LEGATTO_DATA_DIR: '/d' }, 'linux', '/home/a')).toBe('/d');
  });
});

describe('komunikaty błędów sieci', () => {
  it('brak DNS / odmowa połączenia → prośba o włączenie VPN', () => {
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'EHOSTUNREACH']) {
      const err = describeNetworkError(new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code }) }), 'app.biuro.pl');
      expect(err.kind).toBe('offline');
      expect(err.message).toContain('Włącz VPN biura (Tailscale/Headscale)');
    }
  });

  it('błąd certyfikatu → komunikat TLS', () => {
    const err = describeNetworkError(
      new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }) }),
      'app.biuro.pl',
    );
    expect(err.kind).toBe('tls');
  });
});

describe('plik tokenów', () => {
  /** @type {string[]} */
  const dirs = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  const record = {
    v: 1,
    origin: 'https://app.biuro.pl',
    client_id: 'oc_1',
    access_token: 'epm_sekret',
    expires_at: 123,
    refresh_token: null,
    scope: 'mcp',
  };

  it('zapisuje plik 0600 w katalogu 0700 i wczytuje go z powrotem', async () => {
    const base = await mkdtemp(join(tmpdir(), 'legatto-store-'));
    dirs.push(base);
    const dir = join(base, 'dane');
    const store = new TokenStore(dir, record.origin, record.client_id);
    expect(await store.load()).toBeNull();
    await store.save(/** @type {any} */ (record));
    expect(await store.load()).toEqual(record);
    if (process.platform !== 'win32') {
      expect((await stat(store.path)).mode & 0o777).toBe(0o600);
      expect((await stat(dir)).mode & 0o077).toBe(0);
    }
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('naprawia zbyt szerokie uprawnienia i odrzuca uszkodzony albo obcy plik', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'legatto-store-'));
    dirs.push(dir);
    const logs = [];
    const store = new TokenStore(dir, record.origin, record.client_id, (m) => logs.push(m));
    await writeFile(store.path, JSON.stringify(record), { mode: 0o644 });
    expect(await store.load()).toEqual(record);
    if (process.platform !== 'win32') expect((await stat(store.path)).mode & 0o777).toBe(0o600);

    await writeFile(store.path, JSON.stringify({ ...record, origin: 'https://inne.pl' }));
    expect(await store.load()).toBeNull();
    await writeFile(store.path, '{uszkodzony');
    expect(await store.load()).toBeNull();
    await expect(readFile(store.path)).rejects.toThrow();
    expect(logs.join('\n')).not.toContain('epm_sekret');
  });
});

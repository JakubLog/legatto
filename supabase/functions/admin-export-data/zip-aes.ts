// Archiwum ZIP szyfrowane hasłem: WinZip AES-256, format AE-2 (https://www.winzip.com/en/support/aes-encryption/).
// Otwierają je 7-Zip, WinZip, Keka, bsdtar/libarchive. Pliki zapisywane po kolei, strumieniowo
// (każdy wpis w całości w pamięci - pojedynczy plik/ tabela, nie całe archiwum). ZIP64 tylko dla
// katalogu centralnego (archiwum > 4 GiB lub > 65 535 wpisów); pojedynczy wpis < 4 GiB.
//
// Szyfrowanie wpisu:
//   salt 16 B (losowy), PBKDF2-HMAC-SHA1(hasło, salt, 1000) -> 66 B: klucz AES 32 ‖ klucz HMAC 32 ‖ weryfikator 2
//   dane = AES-256-CTR (licznik 128-bit little-endian, od 1) na danych po kompresji (deflate albo store)
//   kod uwierzytelnienia = HMAC-SHA1(klucz HMAC, zaszyfrowane dane)[0..10]
//   wpis = salt ‖ weryfikator ‖ szyfrogram ‖ kod; CRC-32 = 0 (AE-2), metoda 99 + pole extra 0x9901.

import { ecb } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha1 } from '@noble/hashes/legacy.js';

const AES_STRENGTH_256 = 3;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 1000;
const AUTH_CODE_LENGTH = 10;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const METHOD_AES = 99;
const FLAG_ENCRYPTED_UTF8 = 0x0001 | 0x0800;
const VERSION_NEEDED = 51; // AES
const VERSION_MADE_BY = (3 << 8) | 63; // Unix, spec 6.3
const U32_MAX = 0xffffffff;
const CTR_CHUNK = 64 * 1024;

const encoder = new TextEncoder();

interface CentralEntry {
  name: Uint8Array;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
  dosTime: number;
  dosDate: number;
}

function dosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    dosTime: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

/** Pole extra AES (0x9901): wersja AE-2, dostawca "AE", siła 256, właściwa metoda kompresji. */
function aesExtra(method: number): Uint8Array {
  const extra = new Uint8Array(11);
  const v = new DataView(extra.buffer);
  v.setUint16(0, 0x9901, true);
  v.setUint16(2, 7, true);
  v.setUint16(4, 2, true);
  extra[6] = 0x41; // 'A'
  extra[7] = 0x45; // 'E'
  extra[8] = AES_STRENGTH_256;
  v.setUint16(9, method, true);
  return extra;
}

/** AES-256-CTR z licznikiem little-endian (WinZip/Gladman), w miejscu. */
function aesCtrLittleEndian(key: Uint8Array, data: Uint8Array): void {
  const cipher = ecb(key, { disablePadding: true });
  let counter = 1n;
  for (let offset = 0; offset < data.length; offset += CTR_CHUNK) {
    const chunk = data.subarray(offset, Math.min(offset + CTR_CHUNK, data.length));
    const blocks = Math.ceil(chunk.length / 16);
    const counters = new Uint8Array(blocks * 16);
    const view = new DataView(counters.buffer);
    for (let b = 0; b < blocks; b++) {
      view.setBigUint64(b * 16, counter & 0xffffffffffffffffn, true);
      view.setBigUint64(b * 16 + 8, counter >> 64n, true);
      counter += 1n;
    }
    const keystream = cipher.encrypt(counters);
    for (let i = 0; i < chunk.length; i++) chunk[i] ^= keystream[i];
  }
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // Dane wpisów pochodzą z TextEncoder / Blob.arrayBuffer() - zawsze ArrayBuffer, nigdy SharedArrayBuffer.
  const bytes = data as Uint8Array<ArrayBuffer>;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Szyfruje (i opcjonalnie kompresuje) jeden wpis; zwraca dane wpisu i użytą metodę. */
export async function encryptEntry(
  password: string,
  data: Uint8Array,
  compress: boolean,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(SALT_LENGTH)),
): Promise<{ payload: Uint8Array; method: number }> {
  let method = METHOD_STORE;
  let body = data;
  if (compress && data.length > 0) {
    const deflated = await deflateRaw(data);
    if (deflated.length < data.length) {
      method = METHOD_DEFLATE;
      body = deflated;
    }
  }
  const derived = pbkdf2(sha1, encoder.encode(password), salt, { c: PBKDF2_ITERATIONS, dkLen: 66 });
  const aesKey = derived.subarray(0, 32);
  const macKey = derived.subarray(32, 64);
  const verifier = derived.subarray(64, 66);
  const encrypted = body === data ? data.slice() : body;
  aesCtrLittleEndian(aesKey, encrypted);
  const mac = hmac(sha1, macKey, encrypted).subarray(0, AUTH_CODE_LENGTH);
  const payload = new Uint8Array(SALT_LENGTH + 2 + encrypted.length + AUTH_CODE_LENGTH);
  payload.set(salt, 0);
  payload.set(verifier, SALT_LENGTH);
  payload.set(encrypted, SALT_LENGTH + 2);
  payload.set(mac, SALT_LENGTH + 2 + encrypted.length);
  derived.fill(0);
  return { payload, method };
}

/**
 * Pisarz archiwum: addFile() dla każdego wpisu, potem finish(). Każda metoda przekazuje gotowe
 * bajty do `sink` (np. kontroler ReadableStream), więc archiwum nie jest buforowane w całości.
 */
export class AesZipWriter {
  private offset = 0;
  private readonly entries: CentralEntry[] = [];
  private readonly names = new Set<string>();

  constructor(
    private readonly password: string,
    private readonly sink: (chunk: Uint8Array) => void | Promise<void>,
    private readonly now: Date = new Date(),
  ) {
    if (password.length === 0) throw new Error('puste hasło');
  }

  get bytesWritten(): number {
    return this.offset;
  }

  private async emit(chunk: Uint8Array): Promise<void> {
    await this.sink(chunk);
    this.offset += chunk.length;
  }

  async addFile(name: string, data: Uint8Array, options: { compress?: boolean; modified?: Date } = {}): Promise<void> {
    const normalized = name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.split('/').some((p) => p === '..' || p === '')) throw new Error(`niepoprawna nazwa wpisu: ${name}`);
    if (this.names.has(normalized)) throw new Error(`zduplikowana nazwa wpisu: ${name}`);
    if (data.length >= U32_MAX - 64) throw new Error(`wpis za duży: ${name}`);
    this.names.add(normalized);

    const nameBytes = encoder.encode(normalized);
    const { payload, method } = await encryptEntry(this.password, data, options.compress ?? true);
    const { dosTime, dosDate } = dosDateTime(options.modified ?? this.now);
    const extra = aesExtra(method);
    const header = new Uint8Array(30 + nameBytes.length + extra.length);
    const v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, VERSION_NEEDED, true);
    v.setUint16(6, FLAG_ENCRYPTED_UTF8, true);
    v.setUint16(8, METHOD_AES, true);
    v.setUint16(10, dosTime, true);
    v.setUint16(12, dosDate, true);
    v.setUint32(14, 0, true); // CRC-32 = 0 (AE-2)
    v.setUint32(18, payload.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, extra.length, true);
    header.set(nameBytes, 30);
    header.set(extra, 30 + nameBytes.length);

    this.entries.push({ name: nameBytes, method, compressedSize: payload.length, size: data.length, offset: this.offset, dosTime, dosDate });
    await this.emit(header);
    await this.emit(payload);
  }

  async finish(): Promise<void> {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const zip64Offset = e.offset >= U32_MAX;
      const extra = aesExtra(e.method);
      const zip64 = zip64Offset ? new Uint8Array(12) : new Uint8Array(0);
      if (zip64Offset) {
        const zv = new DataView(zip64.buffer);
        zv.setUint16(0, 0x0001, true);
        zv.setUint16(2, 8, true);
        zv.setBigUint64(4, BigInt(e.offset), true);
      }
      const rec = new Uint8Array(46 + e.name.length + zip64.length + extra.length);
      const v = new DataView(rec.buffer);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, VERSION_MADE_BY, true);
      v.setUint16(6, zip64Offset ? 51 : VERSION_NEEDED, true);
      v.setUint16(8, FLAG_ENCRYPTED_UTF8, true);
      v.setUint16(10, METHOD_AES, true);
      v.setUint16(12, e.dosTime, true);
      v.setUint16(14, e.dosDate, true);
      v.setUint32(16, 0, true);
      v.setUint32(20, e.compressedSize, true);
      v.setUint32(24, e.size, true);
      v.setUint16(28, e.name.length, true);
      v.setUint16(30, zip64.length + extra.length, true);
      v.setUint16(32, 0, true); // komentarz
      v.setUint16(34, 0, true); // dysk
      v.setUint16(36, 0, true); // atrybuty wewnętrzne
      v.setUint32(38, (0o100600 << 16) >>> 0, true); // atrybuty zewnętrzne: plik zwykły 0600
      v.setUint32(42, zip64Offset ? U32_MAX : e.offset, true);
      rec.set(e.name, 46);
      rec.set(zip64, 46 + e.name.length);
      rec.set(extra, 46 + e.name.length + zip64.length);
      await this.emit(rec);
    }
    const cdSize = this.offset - cdStart;
    const count = this.entries.length;
    const needZip64 = count >= 0xffff || cdStart >= U32_MAX || cdSize >= U32_MAX;
    if (needZip64) {
      const zip64EocdOffset = this.offset;
      const rec = new Uint8Array(56);
      const v = new DataView(rec.buffer);
      v.setUint32(0, 0x06064b50, true);
      v.setBigUint64(4, 44n, true);
      v.setUint16(12, VERSION_MADE_BY, true);
      v.setUint16(14, 45, true);
      v.setUint32(16, 0, true);
      v.setUint32(20, 0, true);
      v.setBigUint64(24, BigInt(count), true);
      v.setBigUint64(32, BigInt(count), true);
      v.setBigUint64(40, BigInt(cdSize), true);
      v.setBigUint64(48, BigInt(cdStart), true);
      await this.emit(rec);
      const loc = new Uint8Array(20);
      const lv = new DataView(loc.buffer);
      lv.setUint32(0, 0x07064b50, true);
      lv.setUint32(4, 0, true);
      lv.setBigUint64(8, BigInt(zip64EocdOffset), true);
      lv.setUint32(16, 1, true);
      await this.emit(loc);
    }
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, Math.min(count, 0xffff), true);
    ev.setUint16(10, Math.min(count, 0xffff), true);
    ev.setUint32(12, Math.min(cdSize, U32_MAX), true);
    ev.setUint32(16, Math.min(cdStart, U32_MAX), true);
    ev.setUint16(20, 0, true);
    await this.emit(eocd);
  }
}

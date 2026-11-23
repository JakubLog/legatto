// Operacje na bajtach bez zależności od Node (przeglądarka, Node, Workers).

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Dekodowanie UTF-8; niepoprawna sekwencja rzuca TypeError. */
export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new Error('niepoprawny hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Base64 standardowe (z dopełnieniem); inny alfabet albo zła długość rzuca. */
export function fromBase64(text: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) throw new Error('niepoprawny base64');
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function writeU32BE(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value, false);
}

export function readU32BE(source: Uint8Array, offset: number): number {
  return new DataView(source.buffer, source.byteOffset, source.byteLength).getUint32(offset, false);
}

export function writeU64BE(target: Uint8Array, offset: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('u64: poza zakresem');
  new DataView(target.buffer, target.byteOffset, target.byteLength).setBigUint64(offset, BigInt(value), false);
}

/** u64be jako number; wartości > 2^53 tracą precyzję (dla czasu w ms bez znaczenia - i tak poza zakresem). */
export function readU64BE(source: Uint8Array, offset: number): number {
  return Number(new DataView(source.buffer, source.byteOffset, source.byteLength).getBigUint64(offset, false));
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

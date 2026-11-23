import { readU32BE, writeU32BE } from './bytes';

/**
 * Dopełnienie do stałego rozmiaru: u32be(len) ‖ dane ‖ 0x00… (ukrywa długość treści).
 * Rzuca, gdy dane się nie mieszczą.
 */
export function pad(data: Uint8Array, size: number): Uint8Array {
  if (data.length > size - 4) throw new Error(`dane za długie (${data.length} B > ${size - 4} B)`);
  const out = new Uint8Array(size);
  writeU32BE(out, 0, data.length);
  out.set(data, 4);
  return out;
}

/** Odwrotność pad(): sprawdza długość i to, że dopełnienie to same zera. */
export function unpad(padded: Uint8Array, size: number): Uint8Array {
  if (padded.length !== size) throw new Error('zły rozmiar dopełnienia');
  const len = readU32BE(padded, 0);
  if (len > size - 4) throw new Error('zła długość w dopełnieniu');
  for (let i = 4 + len; i < size; i++) {
    if (padded[i] !== 0) throw new Error('niezerowe dopełnienie');
  }
  return padded.slice(4, 4 + len);
}

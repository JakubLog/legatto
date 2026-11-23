// Sealed box zgodny z libsodium crypto_box_seal / crypto_box_seal_open:
//   epk, esk = x25519 keypair (efemeryczny)
//   nonce    = BLAKE2b-192(epk ‖ pk)
//   k        = HSalsa20(X25519(esk, pk), 0^16)          (crypto_box_beforenm)
//   out      = epk ‖ XSalsa20-Poly1305(k, nonce, msg)    (tag ‖ szyfrogram, format secretbox)
// Interop sprawdzony wektorami z libsodium (test/vectors.json, test/sealedbox.test.ts).

import { x25519 } from '@noble/curves/ed25519.js';
import { hsalsa, xsalsa20poly1305 } from '@noble/ciphers/salsa.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { concatBytes } from './bytes';
import { SEAL_OVERHEAD } from './constants';

const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]); // "expand 32-byte k"

function u8ToU32LE(bytes: Uint8Array): Uint32Array {
  const out = new Uint32Array(bytes.length / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}

function u32ToU8LE(words: Uint32Array): Uint8Array {
  const out = new Uint8Array(words.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < words.length; i++) view.setUint32(i * 4, words[i], true);
  return out;
}

/** crypto_box_beforenm: klucz współdzielony HSalsa20(X25519(sk, pk)). */
function beforenm(publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array {
  const shared = x25519.getSharedSecret(secretKey, publicKey);
  const out = new Uint32Array(8);
  hsalsa(SIGMA, u8ToU32LE(shared), new Uint32Array(4), out);
  shared.fill(0);
  return u32ToU8LE(out);
}

function sealNonce(ephemeralPublic: Uint8Array, recipientPublic: Uint8Array): Uint8Array {
  return blake2b(concatBytes(ephemeralPublic, recipientPublic), { dkLen: 24 });
}

/** Szyfruje wiadomość kluczem publicznym odbiorcy (32 B). Wynik: msg.length + 48 B. */
export function seal(message: Uint8Array, recipientPublic: Uint8Array): Uint8Array {
  return sealWithEphemeral(message, recipientPublic, x25519.utils.randomSecretKey());
}

/** Jak seal(), z jawnym kluczem efemerycznym - tylko dla deterministycznych wektorów testowych. */
export function sealWithEphemeral(
  message: Uint8Array,
  recipientPublic: Uint8Array,
  ephemeralSecret: Uint8Array,
): Uint8Array {
  if (recipientPublic.length !== 32) throw new Error('klucz publiczny X25519 musi mieć 32 B');
  const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);
  const key = beforenm(recipientPublic, ephemeralSecret);
  try {
    const boxed = xsalsa20poly1305(key, sealNonce(ephemeralPublic, recipientPublic)).encrypt(message);
    return concatBytes(ephemeralPublic, boxed);
  } finally {
    key.fill(0);
  }
}

/** Otwiera sealed box kluczem prywatnym odbiorcy. Zły klucz lub zmieniony szyfrogram rzuca. */
export function sealOpen(sealed: Uint8Array, recipientSecret: Uint8Array): Uint8Array {
  if (sealed.length < SEAL_OVERHEAD) throw new Error('szyfrogram za krótki');
  if (recipientSecret.length !== 32) throw new Error('klucz prywatny X25519 musi mieć 32 B');
  const recipientPublic = x25519.getPublicKey(recipientSecret);
  const ephemeralPublic = sealed.subarray(0, 32);
  const key = beforenm(ephemeralPublic, recipientSecret);
  try {
    return xsalsa20poly1305(key, sealNonce(ephemeralPublic, recipientPublic)).decrypt(sealed.subarray(32));
  } finally {
    key.fill(0);
  }
}

export function x25519PublicKey(secret: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secret);
}

export function x25519RandomSecret(): Uint8Array {
  return x25519.utils.randomSecretKey();
}

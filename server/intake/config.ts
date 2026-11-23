// Konfiguracja kontenera intake z env i plików (credentials systemd montowane read-only).
// Wartości domyślne = ścieżki z kontraktu legatto-infra (legatto_credentials, legatto_paths).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { fromBase64, keyId, toBase64, x25519PublicKey } from '../../packages/public-submission/src/index';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new ConfigError(`brak zmiennej ${name}`);
}

export function readSecretFile(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    throw new ConfigError(`nie można odczytać pliku ${path}`);
  }
}

export const DEFAULTS = {
  intakeDir: '/intake',
  queuesTokenFile: '/run/credentials/legatto-cf-queues-token',
  caFile: '/etc/legatto/ca/cloudflare-api.pem',
  apiBase: 'https://api.cloudflare.com/client/v4',
  formKeyFile: '/run/credentials/legatto-form-x25519',
  signersDir: '/etc/legatto/intake/signers.d',
  dbPasswordFile: '/run/credentials/legatto-db-intake',
  selftestKeyFile: '/run/credentials/legatto-selftest-ed25519',
} as const;

/**
 * Klucze prywatne formularza: linie `<kid16hex> <base64 32 B>`; pierwsza = aktualny, kolejne =
 * poprzednie (okno rotacji). kid musi zgadzać się z kluczem publicznym wyliczonym z prywatnego.
 */
export function parseFormKeys(text: string): Map<string, Uint8Array> {
  const keys = new Map<string, Uint8Array>();
  for (const [index, line] of text.split('\n').entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([0-9a-f]{16})\s+([A-Za-z0-9+/]{43}=)$/.exec(trimmed);
    if (!match) throw new ConfigError(`plik kluczy formularza: niepoprawna linia ${index + 1}`);
    const secret = fromBase64(match[2]);
    if (keyId(x25519PublicKey(secret)) !== match[1]) {
      throw new ConfigError(`plik kluczy formularza: kid w linii ${index + 1} nie pasuje do klucza`);
    }
    keys.set(match[1], secret);
  }
  if (keys.size === 0) throw new ConfigError('plik kluczy formularza jest pusty');
  return keys;
}

export function formatFormKeyLine(secret: Uint8Array): string {
  return `${keyId(x25519PublicKey(secret))} ${toBase64(secret)}`;
}

/** Klucze publiczne Workera: pliki *.pub z base64 surowego klucza Ed25519 (32 B). */
export function loadSigners(dir: string): Map<string, Uint8Array> {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.pub')).sort();
  } catch {
    throw new ConfigError(`nie można odczytać katalogu ${dir}`);
  }
  const signers = new Map<string, Uint8Array>();
  for (const name of names) {
    const raw = readFileSync(join(dir, name), 'utf8').trim();
    let pub: Uint8Array;
    try {
      pub = fromBase64(raw);
    } catch {
      throw new ConfigError(`${name}: niepoprawny base64`);
    }
    if (pub.length !== 32) throw new ConfigError(`${name}: klucz Ed25519 musi mieć 32 B`);
    try {
      ed25519.Point.fromBytes(pub);
    } catch {
      throw new ConfigError(`${name}: to nie jest punkt Ed25519`);
    }
    signers.set(keyId(pub), pub);
  }
  if (signers.size === 0) throw new ConfigError(`brak kluczy Workera w ${dir}`);
  return signers;
}

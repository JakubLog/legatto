// Klucz szyfrowania pól PII (kontrakt A11; samo szyfrowanie poza zakresem tej zmiany).
//
// Kontrakt:
//   - LEGATTO_PII_KEY_FILE = ścieżka pliku z kluczem; w kontenerze app na VPS
//     /run/secrets/pii_field_key (compose secret z /run/legatto/keys/pii_field_key, tmpfs hosta);
//   - treść: 32 losowe bajty zapisane jako 64 znaki hex (małe litery), opcjonalnie z końcowym "\n"
//     (`openssl rand -hex 32`);
//   - klucz nigdy nie trafia do env, do bazy, do functions ani do logów;
//   - brak zmiennej albo brak pliku = klucz niedostępny (np. przed odblokowaniem przez admina po
//     restarcie, wariant D11-B): aplikacja działa, funkcje wymagające klucza odmawiają;
//   - plik istnieje, ale ma inny format = błąd konfiguracji (health check `pii_key: invalid`).
// Klucz jest czytany przy każdym wywołaniu (odblokowanie po starcie nie wymaga restartu).

import fs from 'node:fs';

export type PiiKeyStatus = 'ok' | 'absent' | 'invalid';

export const PII_KEY_BYTES = 32;

export interface PiiKeyResult {
  status: PiiKeyStatus;
  key: Buffer | null;
}

export function readPiiFieldKey(env: Record<string, string | undefined> = process.env): PiiKeyResult {
  const file = env.LEGATTO_PII_KEY_FILE?.trim();
  if (!file) return { status: 'absent', key: null };
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { status: code === 'ENOENT' ? 'absent' : 'invalid', key: null };
  }
  const hex = raw.replace(/\n$/, '');
  if (!/^[0-9a-f]{64}$/.test(hex)) return { status: 'invalid', key: null };
  return { status: 'ok', key: Buffer.from(hex, 'hex') };
}

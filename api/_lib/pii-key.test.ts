import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPiiFieldKey } from './pii-key';

describe('klucz pól PII (LEGATTO_PII_KEY_FILE)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legatto-pii-'));
  const write = (name: string, content: string) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
  };

  it('64 znaki hex (z \\n albo bez) = 32 bajty', () => {
    const hex = 'ab'.repeat(32);
    for (const content of [hex, `${hex}\n`]) {
      const result = readPiiFieldKey({ LEGATTO_PII_KEY_FILE: write('k', content) });
      expect(result.status).toBe('ok');
      expect(result.key?.length).toBe(32);
    }
  });

  it('brak zmiennej albo pliku = absent, zły format = invalid', () => {
    expect(readPiiFieldKey({}).status).toBe('absent');
    expect(readPiiFieldKey({ LEGATTO_PII_KEY_FILE: path.join(dir, 'brak') }).status).toBe('absent');
    expect(readPiiFieldKey({ LEGATTO_PII_KEY_FILE: write('short', 'abcd') }).status).toBe('invalid');
    expect(readPiiFieldKey({ LEGATTO_PII_KEY_FILE: write('upper', 'AB'.repeat(32)) }).status).toBe('invalid');
    expect(readPiiFieldKey({ LEGATTO_PII_KEY_FILE: dir }).status).toBe('invalid');
  });
});

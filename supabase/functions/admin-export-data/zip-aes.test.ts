import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AesZipWriter, encryptEntry } from './zip-aes';

async function buildZip(password: string, files: [string, Uint8Array][]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const writer = new AesZipWriter(password, (c) => {
    chunks.push(c.slice());
  }, new Date('2026-11-21T12:00:00Z'));
  for (const [name, data] of files) await writer.addFile(name, data);
  await writer.finish();
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  expect(writer.bytesWritten).toBe(out.length);
  return out;
}

const hasBsdtar = (() => {
  try {
    execFileSync('bsdtar', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('ZIP AES-256 (AE-2)', () => {
  it('wpis: salt ‖ weryfikator ‖ szyfrogram ‖ 10 B kodu, bez jawnej treści', async () => {
    const data = new TextEncoder().encode('tajne dane biura '.repeat(100));
    const { payload, method } = await encryptEntry('haslo-testowe-123', data, true, new Uint8Array(16));
    expect(method).toBe(8);
    expect(new TextDecoder('latin1').decode(payload)).not.toContain('tajne');
    const again = await encryptEntry('haslo-testowe-123', data, true, new Uint8Array(16));
    expect(again.payload).toEqual(payload);
    const other = await encryptEntry('inne-haslo-1234', data, true, new Uint8Array(16));
    expect(other.payload.subarray(16, 18)).not.toEqual(payload.subarray(16, 18));
  });

  it('odrzuca ścieżki z .. i duplikaty', async () => {
    const writer = new AesZipWriter('x'.repeat(12), () => undefined);
    await expect(writer.addFile('../etc/passwd', new Uint8Array(1))).rejects.toThrow();
    await writer.addFile('a.txt', new Uint8Array(1));
    await expect(writer.addFile('a.txt', new Uint8Array(1))).rejects.toThrow();
  });

  it.runIf(hasBsdtar)('libarchive (bsdtar) rozpakowuje archiwum poprawnym hasłem, a złym nie', async () => {
    const big = new Uint8Array(200_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + (i >> 7)) & 0xff;
    const zip = await buildZip('Poprawne-Haslo-2026', [
      ['README.txt', new TextEncoder().encode('Eksport danych biura - zażółć gęślą jaźń\n')],
      ['tables/cases.jsonl', new TextEncoder().encode('{"id":1}\n'.repeat(5000))],
      ['files/case-attachments/a/b.bin', big],
      ['empty.txt', new Uint8Array(0)],
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'legatto-zip-'));
    try {
      writeFileSync(join(dir, 'e.zip'), zip);
      execFileSync('bsdtar', ['-x', '-C', dir, '--passphrase', 'Poprawne-Haslo-2026', '-f', join(dir, 'e.zip')]);
      expect(readFileSync(join(dir, 'README.txt'), 'utf8')).toContain('zażółć');
      expect(readFileSync(join(dir, 'tables/cases.jsonl'), 'utf8').split('\n').length).toBe(5001);
      expect(new Uint8Array(readFileSync(join(dir, 'files/case-attachments/a/b.bin')))).toEqual(big);
      expect(readFileSync(join(dir, 'empty.txt')).length).toBe(0);
      const wrong = mkdtempSync(join(tmpdir(), 'legatto-zip-wrong-'));
      try {
        expect(() =>
          execFileSync('bsdtar', ['-x', '-C', wrong, '--passphrase', 'zle-haslo', '-f', join(dir, 'e.zip')], { stdio: 'pipe' }),
        ).toThrow();
      } finally {
        rmSync(wrong, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

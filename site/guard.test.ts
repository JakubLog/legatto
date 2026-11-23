import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { guardDist, PAGES_MAX_FILE_BYTES } from './guard';

const dirs: string[] = [];
function dist(files: Record<string, string | Uint8Array>): string {
  const dir = mkdtempSync(join(tmpdir(), 'legatto-guard-'));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const issues = (dir: string, deny: string[] = []) => guardDist(dir, deny).findings.map((f) => `${f.file}: ${f.issue}`);

describe('guardDist', () => {
  it('przepuszcza czystą stronę i liczy pliki oraz bajty', () => {
    const dir = dist({ 'index.html': '<h1>Biuro</h1>', '_app/a.js': 'console.log(1)', 'assets/x.png': new Uint8Array([1, 2]) });
    expect(guardDist(dir, ['crm.biuro.example'])).toEqual({ ok: true, files: 3, bytes: 14 + 14 + 2, findings: [] });
  });

  it('wykrywa adresy Supabase i JWT', () => {
    const dir = dist({
      'index.html': 'fetch("https://x.example/rest/v1/offices")',
      '_app/a.js': 'const u = "/STORAGE/V1/object"; const f = "/functions/v1/x";',
      'data/x.json': '{"k":"eyJhbGciOiJIUzI1NiJ9"}',
      'n/abc/index.html': 'https://abcdefgh.SupaBase.co',
    });
    expect(issues(dir).sort()).toEqual(
      [
        '_app/a.js: /storage/v1',
        '_app/a.js: /functions/v1',
        'data/x.json: eyJ',
        'index.html: /rest/v1',
        'n/abc/index.html: supabase',
      ].sort(),
    );
  });

  it('nie zgłasza „eyJ” w plikach binarnych, ale „supabase” tak', () => {
    const dir = dist({ 'fonts/a.woff2': 'xxeyJxx', 'assets/b.png': 'supabase' });
    expect(issues(dir)).toEqual(['assets/b.png: supabase']);
  });

  it('wykrywa hosty z --deny-host bez rozróżniania wielkości liter, także w nazwach plików', () => {
    const dir = dist({ 'index.html': '<a href="https://CRM.Biuro.Example/biuro">', 'app.biuro.example.txt': 'x' });
    expect(issues(dir, ['crm.biuro.example', 'APP.biuro.example']).sort()).toEqual(
      ['app.biuro.example.txt: host app.biuro.example', 'index.html: host crm.biuro.example'].sort(),
    );
  });

  it('blokuje Pages Functions: _worker.js i katalog functions/', () => {
    const dir = dist({ '_worker.js': 'export default {}', 'functions/api.js': 'x' });
    expect(issues(dir)).toEqual(expect.arrayContaining(['_worker.js: _worker.js', 'functions: katalog functions/']));
  });

  it('pilnuje limitu rozmiaru pliku Pages', () => {
    const dir = dist({ 'assets/big.png': new Uint8Array(PAGES_MAX_FILE_BYTES + 1) });
    expect(issues(dir)).toEqual([`assets/big.png: plik większy niż ${PAGES_MAX_FILE_BYTES} B`]);
  });
});

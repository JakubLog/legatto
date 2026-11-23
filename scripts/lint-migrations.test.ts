import { describe, expect, it } from 'vitest';
import { findBreakingOps, lintMigrations, parseHeader, sha256 } from './lint-migrations.mjs';

const RELEASED: Record<string, true> = { 'v1.0.0': true, 'v1.1.0': true };
const isReleasedBy = (tag: string) => RELEASED[tag] === true;

function lint(files: { name: string; sql: string }[], baseline: Record<string, string> = {}, previousRelease: string | null = 'v1.1.0') {
  return lintMigrations({ files, baseline, previousRelease, isReleasedBy }) as string[];
}

describe('findBreakingOps', () => {
  it('pomija operacje addytywne i DROP POLICY/TRIGGER/INDEX/CONSTRAINT', () => {
    const sql = `
      create table if not exists public.t (id uuid primary key);
      alter table public.t add column if not exists note text;
      drop policy if exists p on public.t;
      drop trigger if exists tr on public.t;
      drop index if exists public.t_idx;
      alter table public.t drop constraint if exists t_chk;
      alter table public.t alter column note drop not null;
      revoke truncate, references on all tables in schema public from anon;`;
    expect(findBreakingOps(sql)).toEqual([]);
  });

  it('wykrywa DROP TABLE/COLUMN, RENAME, zmianę typu, SET NOT NULL, DROP DEFAULT, TRUNCATE', () => {
    const sql = `
      drop table public.old;
      alter table public.t drop column legacy;
      alter table public.t drop other;
      alter table public.t rename column a to b;
      alter table public.t alter column c type bigint;
      alter table public.t alter column d set not null;
      alter table public.t alter column e drop default;
      truncate public.t;`;
    const kinds = findBreakingOps(sql).map((op: string) => op.split(':')[0]);
    expect(kinds).toEqual([
      'DROP TABLE',
      'DROP COLUMN',
      'DROP COLUMN',
      'RENAME',
      'ALTER COLUMN TYPE',
      'SET NOT NULL',
      'DROP DEFAULT',
      'TRUNCATE',
    ]);
  });

  it('dopuszcza DROP FUNCTION/VIEW tworzonej ponownie w tym samym pliku', () => {
    const sql = `
      drop function if exists public.f(int);
      create or replace function public.f(p bigint) returns int language sql as $$ select 1 $$;
      drop view if exists v;
      create view public.v as select 1;`;
    expect(findBreakingOps(sql)).toEqual([]);
  });

  it('ignoruje komentarze, literały i ciała funkcji, ale sprawdza bloki DO', () => {
    const ignored = `
      -- drop table public.x;
      /* alter table t rename to u; */
      select 'drop table public.y';
      create function public.g() returns void language plpgsql as $fn$ begin drop table public.z; end $fn$;`;
    expect(findBreakingOps(ignored)).toEqual([]);
    const inDo = `do $$ begin if true then alter type public.s rename value 'a' to 'b'; end if; end $$;`;
    expect(findBreakingOps(inDo).map((op: string) => op.split(':')[0])).toEqual(['RENAME']);
  });
});

describe('parseHeader', () => {
  it('czyta nagłówek tylko z początkowego bloku komentarzy', () => {
    expect(parseHeader('-- opis\n--\n-- compat-n-1: expand\ncreate table t();').compat).toBe('expand');
    expect(parseHeader('create table t();\n-- compat-n-1: safe').compat).toBeNull();
    const contract = parseHeader('-- compat-n-1: contract\n-- contract-after: v1.0.0\n');
    expect(contract).toMatchObject({ compat: 'contract', contractAfter: 'v1.0.0' });
  });
});

describe('lintMigrations', () => {
  const old = { name: '20260101000000_init.sql', sql: 'create table t (a int);\nalter table t rename to u;\n' };
  const baseline = { [old.name]: sha256(old.sql) };

  it('przepuszcza baseline bez nagłówka i nową migrację safe', () => {
    const fresh = { name: '20260201000000_add.sql', sql: '-- compat-n-1: safe\nalter table u add column b int;\n' };
    expect(lint([old, fresh], baseline)).toEqual([]);
  });

  it('odrzuca zmienioną lub usuniętą migrację z baseline', () => {
    expect(lint([{ ...old, sql: old.sql + '-- zmiana\n' }], baseline)[0]).toMatch(/zmieniona migracja z baseline/);
    expect(lint([], baseline)[0]).toMatch(/usunięta/);
  });

  it('wymaga nagłówka i poprawnej nazwy, odrzuca wersję starszą niż baseline', () => {
    const errors = lint(
      [old, { name: '20250101000000_early.sql', sql: '-- compat-n-1: safe\n' }, { name: 'Bad.sql', sql: '' },
        { name: '20260301000000_nohdr.sql', sql: 'select 1;' }],
      baseline,
    );
    expect(errors.join('\n')).toMatch(/early.sql: wersja nie większa/);
    expect(errors.join('\n')).toMatch(/Bad.sql: niepoprawna nazwa/);
    expect(errors.join('\n')).toMatch(/nohdr.sql: brak nagłówka/);
  });

  it('odrzuca operację łamiącą N-1 poza etapem contract', () => {
    const f = { name: '20260201000000_drop.sql', sql: '-- compat-n-1: expand\nalter table u drop column a;\n' };
    expect(lint([old, f], baseline)[0]).toMatch(/DROP COLUMN.*tylko w etapie contract/);
  });

  it('contract wymaga contract-after zawartego w poprzednim wydaniu', () => {
    const drop = 'alter table u drop column a;\n';
    const ok = { name: '20260201000000_c.sql', sql: `-- compat-n-1: contract\n-- contract-after: v1.0.0\n${drop}` };
    expect(lint([old, ok], baseline)).toEqual([]);
    const tooEarly = { ...ok, sql: `-- compat-n-1: contract\n-- contract-after: v1.2.0\n${drop}` };
    expect(lint([old, tooEarly], baseline)[0]).toMatch(/nie zawiera się w poprzednim wydaniu/);
    expect(lint([old, ok], baseline, null)[0]).toMatch(/bez poprzedniego wydania/);
    const missing = { ...ok, sql: `-- compat-n-1: contract\n${drop}` };
    expect(lint([old, missing], baseline)[0]).toMatch(/contract-after/);
  });
});

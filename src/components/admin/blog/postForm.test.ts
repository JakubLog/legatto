import { describe, expect, it } from 'vitest';

import { fromDateTimeLocal, POST_SLUG_RE, postFormSchema, slugify, toDateTimeLocal } from './postForm';

describe('slugify', () => {
  it('usuwa polskie znaki i interpunkcję', () => {
    expect(slugify('Spotkanie w Łodzi – relacja!')).toBe('spotkanie-w-lodzi-relacja');
    expect(slugify('Zażółć gęślą jaźń')).toBe('zazolc-gesla-jazn');
  });

  it('obcina myślniki na brzegach', () => {
    expect(slugify('  --Nowy wpis--  ')).toBe('nowy-wpis');
    expect(slugify('!!!')).toBe('');
  });

  it('daje adres zgodny z CHECK bazy, także po obcięciu do 80 znaków', () => {
    const slug = slugify(`${'a'.repeat(79)} b`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug).toMatch(POST_SLUG_RE);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('postFormSchema', () => {
  const base = {
    title: 'Tytuł',
    slug: 'tytul',
    excerpt: '',
    body_md: '# Treść',
    cover_path: '',
    status: 'draft' as const,
    published_at: '',
  };

  it('przyjmuje poprawny wpis', () => {
    expect(postFormSchema.safeParse(base).success).toBe(true);
  });

  it('odrzuca slug z wielkimi literami albo myślnikiem na końcu', () => {
    expect(postFormSchema.safeParse({ ...base, slug: 'Tytul' }).success).toBe(false);
    expect(postFormSchema.safeParse({ ...base, slug: 'tytul-' }).success).toBe(false);
  });

  it('liczy limit treści w bajtach UTF-8', () => {
    expect(postFormSchema.safeParse({ ...base, body_md: 'ż'.repeat(100_001) }).success).toBe(false);
    expect(postFormSchema.safeParse({ ...base, body_md: 'z'.repeat(200_000) }).success).toBe(true);
  });
});

describe('daty publikacji', () => {
  it('przechodzi w obie strony przez pole datetime-local', () => {
    const iso = '2026-11-21T09:30:00.000Z';
    expect(fromDateTimeLocal(toDateTimeLocal(iso))).toBe(iso);
  });

  it('puste pole = brak daty', () => {
    expect(toDateTimeLocal(null)).toBe('');
    expect(fromDateTimeLocal('')).toBeNull();
  });
});

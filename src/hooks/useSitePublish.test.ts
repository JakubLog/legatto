import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { normalizePublicSiteUrl } from './useSitePublish';

describe('normalizePublicSiteUrl', () => {
  it('przyjmuje origin https (także z portem), normalizuje wielkość liter i ukośnik', () => {
    expect(normalizePublicSiteUrl(' https://Jan-Kowalski.pl/ ')).toBe('https://jan-kowalski.pl');
    expect(normalizePublicSiteUrl('https://strona.example.pl:8443')).toBe('https://strona.example.pl:8443');
  });

  it('puste pole = brak strony posła', () => {
    expect(normalizePublicSiteUrl('   ')).toBe('');
  });

  it('odrzuca http, ścieżki i inne schematy', () => {
    expect(normalizePublicSiteUrl('http://jan-kowalski.pl')).toBeNull();
    expect(normalizePublicSiteUrl('https://jan-kowalski.pl/blog')).toBeNull();
    expect(normalizePublicSiteUrl('jan-kowalski.pl')).toBeNull();
    expect(normalizePublicSiteUrl('https://user@jan-kowalski.pl')).toBeNull();
  });
});

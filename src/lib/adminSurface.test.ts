import { describe, expect, it } from 'vitest';

import { adminUrl, isAdminSurfaceRequired } from './adminSurface';

describe('isAdminSurfaceRequired', () => {
  it('wymaga panelu tylko na powierzchni crm', () => {
    expect(isAdminSurfaceRequired({ surface: 'crm', adminOrigin: 'https://admin.app.example.pl' })).toBe(true);
    expect(isAdminSurfaceRequired({ surface: 'admin', adminOrigin: 'https://admin.app.example.pl' })).toBe(false);
    expect(isAdminSurfaceRequired({ surface: null, adminOrigin: null })).toBe(false);
  });
});

describe('adminUrl', () => {
  const config = { surface: 'crm' as const, adminOrigin: 'https://admin.app.example.pl' };

  it('dokleja ścieżkę do originu panelu', () => {
    expect(adminUrl('/biuro/admin/eksport-danych', config)).toBe(
      'https://admin.app.example.pl/biuro/admin/eksport-danych',
    );
  });

  it('normalizuje ukośniki', () => {
    expect(adminUrl('biuro', { ...config, adminOrigin: 'https://admin.app.example.pl/' })).toBe(
      'https://admin.app.example.pl/biuro',
    );
  });

  it('zwraca null bez originu panelu (Vercel)', () => {
    expect(adminUrl('/biuro', { surface: null, adminOrigin: null })).toBeNull();
  });
});

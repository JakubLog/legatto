import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { exportPasswordStrength, filenameFromContentDisposition } from './useDataExport';

describe('exportPasswordStrength', () => {
  it('odrzuca hasła krótsze niż 12 znaków', () => {
    expect(exportPasswordStrength('Kr0tkie!')).toBe(0);
  });

  it('powtórzenia są słabe', () => {
    expect(exportPasswordStrength('aaaaaaaaaaaaaaaa')).toBe(1);
  });

  it('rośnie z długością i różnorodnością znaków', () => {
    expect(exportPasswordStrength('kot-pies-dom')).toBe(1);
    expect(exportPasswordStrength('Kot-Pies-Dom-2026')).toBe(3);
    expect(exportPasswordStrength('Kot-Pies-Dom-Las-2026!')).toBe(4);
  });
});

describe('filenameFromContentDisposition', () => {
  const fallback = 'legatto-eksport.zip';

  it('czyta filename w cudzysłowie', () => {
    expect(filenameFromContentDisposition('attachment; filename="legatto-eksport-2026-11-22.zip"', fallback)).toBe(
      'legatto-eksport-2026-11-22.zip',
    );
  });

  it('filename* ma pierwszeństwo', () => {
    expect(
      filenameFromContentDisposition(
        `attachment; filename="a.zip"; filename*=UTF-8''eksport%20biura%20%C5%81%C3%B3d%C5%BA.zip`,
        fallback,
      ),
    ).toBe('eksport biura Łódź.zip');
  });

  it('usuwa ścieżki i wraca do nazwy domyślnej', () => {
    expect(filenameFromContentDisposition('attachment; filename="../../etc/passwd"', fallback)).toBe('_.._etc_passwd');
    expect(filenameFromContentDisposition(null, fallback)).toBe(fallback);
    expect(filenameFromContentDisposition('attachment', fallback)).toBe(fallback);
  });
});

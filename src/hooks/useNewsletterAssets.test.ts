import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { newsletterAssetPath, sha256Hex } from './useNewsletterAssets';

describe('sha256Hex', () => {
  it('liczy sha256 treści (wektor NIST "abc")', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('newsletterAssetPath', () => {
  const userId = '7d9f6a5e-1111-4222-8333-944455556666';

  it('ścieżka {userId}/{sha256}.{ext} - ten sam plik, ta sama ścieżka', async () => {
    const a = new File(['abc'], 'zdjęcie 1.JPEG', { type: 'image/jpeg' });
    const b = new File(['abc'], 'inna-nazwa.jpg', { type: 'image/jpeg' });
    const path = await newsletterAssetPath(userId, a);
    expect(path).toBe(`${userId}/ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad.jpg`);
    expect(await newsletterAssetPath(userId, b)).toBe(path);
  });

  it('rozszerzenie z typu MIME (png|jpg|webp|gif), inne odrzuca', async () => {
    expect(await newsletterAssetPath(userId, new File(['x'], 'a', { type: 'image/webp' }))).toMatch(/\.webp$/);
    expect(await newsletterAssetPath(userId, new File(['x'], 'a', { type: 'image/gif' }))).toMatch(/\.gif$/);
    await expect(newsletterAssetPath(userId, new File(['x'], 'a.svg', { type: 'image/svg+xml' }))).rejects.toThrow();
  });
});

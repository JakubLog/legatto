import { describe, expect, it } from 'vitest';
import {
  detectImageType,
  ImageError,
  parseStorageUrl,
  rewriteMarkdownImages,
  rewriteNewsletterHtml,
  stripJpegMetadata,
  type AssetResolver,
} from './assets';
import { GIF, JPEG_STRIPPED, JPEG_WITH_EXIF, PNG, WEBP } from './testImages';

const SHA = 'a'.repeat(64);
const STORAGE = 'https://abcdefgh.supabase.co/storage/v1/object/public';

/** Resolver testowy: obrazy z Storage -> lokalny zasób, wszystko inne odrzucone. */
const resolver: AssetResolver = async (url) => (parseStorageUrl(url) ? { sha256: SHA, ext: 'png' } : null);

describe('parseStorageUrl', () => {
  it('rozpoznaje publiczne obiekty dozwolonych bucketów (host bez znaczenia)', () => {
    expect(parseStorageUrl(`${STORAGE}/site-assets/homepage/1.jpg`)).toEqual({ bucket: 'site-assets', path: 'homepage/1.jpg' });
    expect(parseStorageUrl('http://api-gw:8000/storage/v1/object/public/avatars/u1/a%20b.png')).toBeNull();
    expect(parseStorageUrl('/storage/v1/object/public/newsletter-assets/u1/x.png')).toEqual({
      bucket: 'newsletter-assets',
      path: 'u1/x.png',
    });
  });

  it('odrzuca inne buckety, ścieżki z .., zapytania i obce adresy', () => {
    expect(parseStorageUrl(`${STORAGE}/documents/secret.pdf`)).toBeNull();
    expect(parseStorageUrl(`${STORAGE}/site-assets/../documents/x.png`)).toBeNull();
    expect(parseStorageUrl(`${STORAGE}/site-assets/%2e%2e/x.png`)).toBeNull();
    expect(parseStorageUrl(`${STORAGE}/site-assets/a.png?download=1`)).toBeNull();
    expect(parseStorageUrl('https://tracker.example.net/pixel.gif')).toBeNull();
    expect(parseStorageUrl('javascript:alert(1)')).toBeNull();
    expect(parseStorageUrl(`${STORAGE.replace('/public', '/sign')}/site-assets/a.png`)).toBeNull();
  });
});

describe('detectImageType', () => {
  it('po magic bytes', () => {
    expect(detectImageType(PNG)).toBe('png');
    expect(detectImageType(JPEG_WITH_EXIF)).toBe('jpg');
    expect(detectImageType(WEBP)).toBe('webp');
    expect(detectImageType(GIF)).toBe('gif');
    expect(detectImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe('stripJpegMetadata', () => {
  it('usuwa EXIF, XMP, IPTC i komentarze, zostawia JFIF, ICC i dane obrazu', () => {
    const out = stripJpegMetadata(JPEG_WITH_EXIF);
    expect([...out]).toEqual([...JPEG_STRIPPED]);
    const text = Buffer.from(out).toString('latin1');
    for (const secret of ['Exif', 'GPS', 'xmpmeta', 'IPTC', 'komentarz']) expect(text).not.toContain(secret);
    expect(text).toContain('ICC_PROFILE');
  });

  it('jest idempotentne', () => {
    expect([...stripJpegMetadata(JPEG_STRIPPED)]).toEqual([...JPEG_STRIPPED]);
  });

  it('odrzuca uszkodzone pliki', () => {
    expect(() => stripJpegMetadata(PNG)).toThrow(ImageError);
    expect(() => stripJpegMetadata(JPEG_WITH_EXIF.subarray(0, 30))).toThrow(ImageError);
    expect(() => stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00]))).toThrow(ImageError);
  });
});

describe('rewriteMarkdownImages', () => {
  it('Storage -> /assets/, obce obrazy usunięte, reszta treści bez zmian', async () => {
    const md = [
      'Tekst ![zdjęcie](' + STORAGE + '/site-assets/blog/1.jpg "Podpis") dalej.',
      '![obcy](https://tracker.example.net/p.gif)',
      '![lokalny](/assets/' + SHA + '.png)',
      '[link](https://sejm.gov.pl)',
    ].join('\n');
    expect(await rewriteMarkdownImages(md, resolver)).toBe(
      [`Tekst ![zdjęcie](/assets/${SHA}.png "Podpis") dalej.`, '', `![lokalny](/assets/${SHA}.png)`, '[link](https://sejm.gov.pl)'].join(
        '\n',
      ),
    );
  });
});

describe('rewriteNewsletterHtml', () => {
  it('obrazy -> /n/a/, fonty -> /fonts/newsletter/, obce obrazy i tła usunięte', async () => {
    const html = [
      `<img src="${STORAGE}/newsletter-assets/u/x.png" srcset="https://tracker.example.net/2x.png 2x" alt="a">`,
      '<IMG alt="b" src=\'https://tracker.example.net/open.gif\'>',
      '<td background="https://tracker.example.net/bg.png">x</td>',
      "<style>@font-face{src:url('https://crm.biuro.example/fonts/newsletter/source-sans-3-latin-wght-normal.woff2')}",
      '.h{background:url(https://tracker.example.net/h.png)} .d{background:url(data:image/png;base64,AAAA)}</style>',
      '<a href="https://sejm.gov.pl">link</a>',
    ].join('');
    const out = await rewriteNewsletterHtml(html, resolver);
    expect(out).toBe(
      [
        `<img src="/n/a/${SHA}.png" alt="a">`,
        '',
        '<td>x</td>',
        "<style>@font-face{src:url('/fonts/newsletter/source-sans-3-latin-wght-normal.woff2')}",
        '.h{background:url()} .d{background:url(data:image/png;base64,AAAA)}</style>',
        '<a href="https://sejm.gov.pl">link</a>',
      ].join(''),
    );
    expect(out).not.toContain('tracker.example.net');
    expect(out).not.toContain('crm.biuro.example');
  });
});

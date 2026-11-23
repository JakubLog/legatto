// Obrazy testowe generatora strony (vitest): poprawne nagłówki formatów, bez prawdziwych pikseli
// (generator sprawdza tylko magic bytes i strukturę segmentów JPEG).

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? [...Buffer.from(part, 'latin1')] : part)));

const segment = (marker: number, payload: Uint8Array) => {
  const length = payload.length + 2;
  return [...bytes([0xff, marker, length >> 8, length & 0xff]), ...payload];
};

export const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'IHDR-fixture-png');
export const GIF = bytes('GIF89a', [1, 0, 1, 0]);
export const WEBP = bytes('RIFF', [4, 0, 0, 0], 'WEBPVP8 ');

const JFIF = segment(0xe0, bytes('JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0]));
const EXIF = segment(0xe1, bytes('Exif\0\0', 'GPS 53.7784N 20.4801E Canon EOS serial 1234'));
const XMP = segment(0xe1, bytes('http://ns.adobe.com/xap/1.0/\0', '<x:xmpmeta>autor</x:xmpmeta>'));
const ICC = segment(0xe2, bytes('ICC_PROFILE\0', [1, 1], 'display-p3'));
const IPTC = segment(0xed, bytes('Photoshop 3.0\0', 'IPTC autor'));
const COMMENT = segment(0xfe, bytes('komentarz z aparatu'));
const DQT = segment(0xdb, new Uint8Array(65));
const SOS = [...segment(0xda, new Uint8Array(10)), 0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9];

/** JPEG z metadanymi (EXIF z GPS, XMP, IPTC, komentarz) i profilem ICC. */
export const JPEG_WITH_EXIF = new Uint8Array([0xff, 0xd8, ...JFIF, ...EXIF, ...XMP, ...ICC, ...IPTC, ...COMMENT, ...DQT, ...SOS]);
/** Ten sam obraz po usunięciu metadanych (zostają JFIF, ICC, tablice i dane obrazu). */
export const JPEG_STRIPPED = new Uint8Array([0xff, 0xd8, ...JFIF, ...ICC, ...DQT, ...SOS]);

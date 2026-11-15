import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { AttachmentBlock, AttachmentKind } from '@/lib/poliai';

// Przygotowanie załączników PoliAI w przeglądarce: kompresja obrazów i stron PDF do
// standardowego tieru wizji Claude oraz wyciąganie tekstu (ai-lib/plans/2026-10-26-poliai-zalaczniki.md).

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 30;
export const MAX_TEXT_CHARS = 150_000;

/** Dłuższy bok obrazu po kompresji. */
const MAX_EDGE_PX = 1568;
/** Limit tokenów wizualnych: ceil(w/28) * ceil(h/28). */
const MAX_VISION_TOKENS = 1568;
const VISION_TILE_PX = 28;
const QUALITY = 0.82;
/** Pliki pomocnicze pdf.js kopiowane przez plugin `pdfjsAssets` w vite.config.ts. */
const PDFJS_ASSETS = '/pdfjs/';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const MIME_KINDS: Record<string, AttachmentKind> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/heic': 'image',
  'image/heif': 'image',
  'application/pdf': 'pdf',
  [DOCX_MIME]: 'docx',
  'text/plain': 'text',
  'text/csv': 'text',
  'text/markdown': 'text',
  'text/x-markdown': 'text',
};

const EXTENSION_MIMES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  docx: DOCX_MIME,
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  markdown: 'text/markdown',
};

/** Wartość `accept` pola wyboru plików. */
export const ACCEPT = [
  ...Object.keys(MIME_KINDS).filter((mime) => mime !== 'text/x-markdown'),
  ...Object.keys(EXTENSION_MIMES).map((ext) => `.${ext}`),
].join(',');

/** Błąd z komunikatem dla użytkownika (po polsku). */
export class PoliAIFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoliAIFileError';
  }
}

export interface ProcessedImage {
  blob: Blob;
  ext: 'webp' | 'jpg' | 'png';
  contentType: string;
}

export interface ProcessedPage {
  image?: ProcessedImage;
  text: string;
}

export interface ProcessedFile {
  kind: AttachmentKind;
  /** MIME oryginału (uzupełniony z rozszerzenia, gdy przeglądarka go nie podała). */
  mime: string;
  originalSize: number;
  pages: ProcessedPage[];
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function resolveType(file: File): { kind: AttachmentKind; mime: string } {
  const type = file.type.toLowerCase();
  const byMime = MIME_KINDS[type];
  if (byMime) return { kind: byMime, mime: type };
  const ext = extension(file.name);
  const mime = EXTENSION_MIMES[ext];
  if (mime) return { kind: MIME_KINDS[mime], mime };
  if (ext === 'doc' || type === 'application/msword') {
    throw new PoliAIFileError(`„${file.name}” to stary format Word (.doc). Zapisz go jako .docx albo PDF.`);
  }
  throw new PoliAIFileError(
    `Nieobsługiwany format pliku „${file.name}”. Dołącz obraz (JPG, PNG, WebP, GIF, HEIC), PDF, DOCX albo plik tekstowy (TXT, CSV, MD).`,
  );
}

/** Rodzaj załącznika po MIME, potem po rozszerzeniu; nieobsługiwane formaty rzucają `PoliAIFileError`. */
export function detectKind(file: File): AttachmentKind {
  return resolveType(file).kind;
}

/** Limit 20 MB przed kompresją i pusty plik - sprawdzane od razu przy dodaniu i przed przetworzeniem. */
export function assertFileSize(file: File): void {
  if (file.size > MAX_FILE_BYTES) {
    throw new PoliAIFileError(`Plik „${file.name}” jest za duży (${formatFileSize(file.size)}). Limit to 20 MB.`);
  }
  if (file.size === 0) throw new PoliAIFileError(`Plik „${file.name}” jest pusty.`);
}

/** Rozmiar pliku po polsku: `420 KB`, `1,4 MB`. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`;
}

/** Opis załącznika do pastylki i podglądu: `PDF · 3 str. · 420 KB`. */
export function attachmentMeta(block: Pick<AttachmentBlock, 'kind' | 'name' | 'pages' | 'size'>): string {
  const label =
    block.kind === 'image'
      ? 'Obraz'
      : block.kind === 'pdf'
        ? 'PDF'
        : block.kind === 'docx'
          ? 'DOCX'
          : extension(block.name).toUpperCase() || 'Tekst';
  const parts = [label];
  if (block.kind === 'pdf') parts.push(`${block.pages} str.`);
  parts.push(formatFileSize(block.size));
  return parts.join(' · ');
}

/**
 * Wymiary w standardowym tierze wizji Claude: dłuższy bok ≤ 1568 px i ≤ 1568 tokenów wizualnych.
 * `upscale` tylko dla stron PDF (wektor) - zdjęć nie powiększamy.
 */
function visionSize(width: number, height: number, upscale: boolean): { width: number; height: number } {
  const tokenScale = Math.sqrt((MAX_VISION_TOKENS * VISION_TILE_PX * VISION_TILE_PX) / (width * height));
  let scale = Math.min(MAX_EDGE_PX / Math.max(width, height), tokenScale);
  if (!upscale) scale = Math.min(scale, 1);
  for (;;) {
    const w = Math.max(1, Math.floor(width * scale));
    const h = Math.max(1, Math.floor(height * scale));
    if (Math.ceil(w / VISION_TILE_PX) * Math.ceil(h / VISION_TILE_PX) <= MAX_VISION_TOKENS) return { width: w, height: h };
    scale *= 0.98;
  }
}

function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PoliAIFileError('Przeglądarka nie pozwoliła przetworzyć obrazu.');
  // Białe tło: przezroczystość w JPEG byłaby czarna, a model lepiej czyta tekst na bieli.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/** WebP 0.82; gdy przeglądarka nie koduje WebP (Safari zwraca PNG) - JPEG 0.82. */
async function encodeCanvas(canvas: HTMLCanvasElement): Promise<ProcessedImage> {
  const webp = await canvasToBlob(canvas, 'image/webp');
  if (webp?.type === 'image/webp') return { blob: webp, ext: 'webp', contentType: 'image/webp' };
  const jpeg = await canvasToBlob(canvas, 'image/jpeg');
  if (!jpeg) throw new PoliAIFileError('Nie udało się skompresować obrazu.');
  return { blob: jpeg, ext: 'jpg', contentType: 'image/jpeg' };
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeImage(file: File, mime: string): Promise<DecodedImage> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    // Safari nie dekoduje HEIC przez createImageBitmap, ale <img> tak.
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new PoliAIFileError(
      mime === 'image/heic' || mime === 'image/heif'
        ? `Ta przeglądarka nie odczyta zdjęcia HEIC „${file.name}”. Otwórz ePosła w Safari albo zapisz zdjęcie jako JPG.`
        : `Ta przeglądarka nie odczyta obrazu „${file.name}”. Zapisz go jako JPG albo PNG.`,
    );
  }
}

// JPEG zawsze przekodowany: usuwa EXIF (GPS, obrót, który nie każdy odczyt uwzględnia).
const KEEP_ORIGINAL: Record<string, ProcessedImage['ext']> = { 'image/png': 'png', 'image/webp': 'webp' };

async function processImage(file: File, mime: string): Promise<ProcessedPage> {
  const decoded = await decodeImage(file, mime);
  try {
    const size = visionSize(decoded.width, decoded.height, false);
    const { canvas, ctx } = createCanvas(size.width, size.height);
    try {
      ctx.drawImage(decoded.source, 0, 0, size.width, size.height);
      const encoded = await encodeCanvas(canvas);
      // Oryginał w limicie wymiarów i mniejszy niż wynik kompresji zostaje bez zmian.
      const originalExt = KEEP_ORIGINAL[mime];
      const fits = size.width === decoded.width && size.height === decoded.height;
      if (originalExt && fits && file.size <= encoded.blob.size) {
        return { image: { blob: file, ext: originalExt, contentType: mime }, text: '' };
      }
      return { image: encoded, text: '' };
    } finally {
      releaseCanvas(canvas);
    }
  } finally {
    decoded.release();
  }
}

let pdfjsPromise: Promise<typeof PdfJsModule> | null = null;

// Import dynamiczny celowo: pdf.js (~1 MB + worker) ładowany dopiero przy pierwszym PDF.
function loadPdfJs(): Promise<typeof PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
    // Nieudany import (np. zerwane połączenie) nie blokuje kolejnej próby.
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

async function processPdf(file: File, signal: AbortSignal | undefined): Promise<ProcessedPage[]> {
  const pdfjs = await loadPdfJs();
  signal?.throwIfAborted();
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${PDFJS_ASSETS}cmaps/`,
    standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSETS}wasm/`,
    // CSP bez 'wasm-unsafe-eval': dekodery skanów (JBIG2, JPEG 2000) ładowane jako JS z wasmUrl.
    useWasm: false,
  });
  try {
    const doc = await task.promise.catch((e: unknown) => {
      if (e instanceof Error && e.name === 'PasswordException') {
        throw new PoliAIFileError(`PDF „${file.name}” jest zabezpieczony hasłem. Zdejmij hasło i dołącz plik ponownie.`);
      }
      throw new PoliAIFileError(`Nie udało się odczytać PDF „${file.name}”. Plik może być uszkodzony.`);
    });
    if (doc.numPages > MAX_PDF_PAGES) {
      throw new PoliAIFileError(
        `PDF „${file.name}” ma ${doc.numPages} stron - limit to ${MAX_PDF_PAGES}. Podziel plik albo dołącz potrzebne strony.`,
      );
    }

    // Strony po kolei - w pamięci jest naraz tylko jeden canvas.
    const pages: ProcessedPage[] = [];
    let budget = MAX_TEXT_CHARS;
    for (let n = 1; n <= doc.numPages; n++) {
      signal?.throwIfAborted();
      const page = await doc.getPage(n);
      try {
        const base = page.getViewport({ scale: 1 });
        const size = visionSize(base.width, base.height, true);
        const viewport = page.getViewport({ scale: size.width / base.width });
        const { canvas } = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
        let image: ProcessedImage;
        try {
          await page.render({ canvas, viewport, background: '#fff' }).promise;
          image = await encodeCanvas(canvas);
        } finally {
          releaseCanvas(canvas);
        }
        const content = await page.getTextContent();
        const raw = content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join('').trim();
        const text = raw.slice(0, Math.max(0, budget));
        budget -= text.length;
        pages.push({ image, text });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

async function processDocx(file: File): Promise<string> {
  // Dynamiczny import: mammoth (~0,6 MB) ładowany tylko przy .docx.
  const { default: mammoth } = await import('mammoth');
  try {
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value.trim();
  } catch {
    throw new PoliAIFileError(`Nie udało się odczytać dokumentu „${file.name}”. Plik może być uszkodzony.`);
  }
}

async function processText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).trim();
  } catch {
    // Starsze pliki z Windows (np. CSV z Excela) bywają w CP1250.
    return new TextDecoder('windows-1250').decode(buffer).trim();
  }
}

/**
 * Przygotowuje plik do wysłania: obraz → 1 skompresowana strona, PDF → strony jako obrazy
 * z tekstem warstwy tekstowej, DOCX/TXT/CSV/MD → 1 strona z treścią, bez obrazu.
 * Rzuca `PoliAIFileError` (komunikat dla użytkownika) albo `AbortError` po `signal.abort()`.
 */
export async function processFile(file: File, options: { signal?: AbortSignal } = {}): Promise<ProcessedFile> {
  const { kind, mime } = resolveType(file);
  assertFileSize(file);

  let pages: ProcessedPage[];
  if (kind === 'image') pages = [await processImage(file, mime)];
  else if (kind === 'pdf') pages = await processPdf(file, options.signal);
  else {
    const text = kind === 'docx' ? await processDocx(file) : await processText(file);
    if (!text) throw new PoliAIFileError(`Plik „${file.name}” nie zawiera tekstu.`);
    pages = [{ text: text.slice(0, MAX_TEXT_CHARS) }];
  }
  options.signal?.throwIfAborted();
  return { kind, mime, originalSize: file.size, pages };
}

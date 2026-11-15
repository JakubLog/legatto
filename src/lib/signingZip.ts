// Paczki ZIP "do podpisu" (plan 2.3) i rozpakowanie wgranego .zip z podpisanymi plikami (plan 2.2).
// Bez kompresji (PDF i DOCX są już skompresowane) i bez Web Workerów fflate (CSP `script-src 'self'`
// nie pozwala na workery z blob:), więc tylko synchroniczne API: `Zip` + `ZipPassThrough`, `unzipSync`.

import { Zip, ZipPassThrough, strToU8, unzipSync } from 'fflate';
import { format } from 'date-fns';
import { SIGNED_ZIP_MAX_BYTES, SIGNED_ZIP_MAX_ENTRIES, SIGNING_BATCH_MAX, formatFileSize } from '@/lib/signing';

export interface BatchZipEntry {
  zip_name: string;
  load: () => Promise<Blob>;
}

export interface BatchListRow {
  code: string;
  title: string;
  recipient: string | null;
  author: string | null;
  zip_name: string;
}

/** Nazwa pobieranego archiwum: `do-podpisu_PACZKA-000012_2026-11-11.zip`. */
export function batchZipFilename(batchCode: string, date: Date = new Date()): string {
  return `do-podpisu_${batchCode}_${format(date, 'yyyy-MM-dd')}.zip`;
}

/** Dzieli zaznaczenie na kolejne paczki po 20 (wejście posortowane od najstarszych). */
export function splitIntoBatches<T>(items: T[], size = SIGNING_BATCH_MAX): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function listText(batchCode: string, rows: BatchListRow[]): string {
  const lines = [
    `Paczka: ${batchCode}`,
    `Utworzona: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
    `Dokumentów: ${rows.length}`,
    '',
    ['Kod', 'Tytuł', 'Adresat', 'Autor', 'Plik'].join('\t'),
    ...rows.map((r) => [r.code, r.title, r.recipient ?? '-', r.author ?? '-', r.zip_name].join('\t')),
    '',
    'Podpisane pliki wgraj w portalu (Dokumenty do podpisu → Wgraj podpisane). Nazwa pliku musi zaczynać się',
    'od kodu i wersji, np. DP-000123_v1_... - wtedy portal sam dopasuje dokument.',
  ];
  // BOM: polskie znaki poprawnie także w starszych edytorach Windows.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * Buduje ZIP paczki: pliki w kolejności pozycji (pobierane po kolei, żeby nie trzymać w pamięci
 * więcej niż trzeba przed zapisem) i `_lista.txt`. `onProgress(n, total)` po każdym pliku.
 */
export async function buildBatchZip(
  batchCode: string,
  entries: BatchZipEntry[],
  rows: BatchListRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const state: { failure: Error | null } = { failure: null };
  const zip = new Zip((err, chunk) => {
    if (err) state.failure = err;
    else chunks.push(chunk);
  });
  const addFile = (name: string, data: Uint8Array) => {
    const file = new ZipPassThrough(name);
    file.mtime = new Date();
    zip.add(file);
    file.push(data, true);
  };

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const data = new Uint8Array(await (await entry.load()).arrayBuffer());
    addFile(entry.zip_name, data);
    onProgress?.(i + 1, entries.length);
  }
  addFile('_lista.txt', strToU8(listText(batchCode, rows)));
  zip.end();
  if (state.failure) throw state.failure;
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}

export interface ExtractedFile {
  name: string;
  data: Uint8Array;
}

/** Pomija katalogi, metadane macOS (`__MACOSX/`, `._*`) i pliki ukryte. */
function isSkippedEntry(path: string): boolean {
  if (path.endsWith('/')) return true;
  const parts = path.split('/');
  if (parts.includes('__MACOSX')) return true;
  const base = parts[parts.length - 1];
  return base.startsWith('.') || base === 'Thumbs.db' || base === 'desktop.ini';
}

/**
 * Rozpakowuje wgrany .zip z podpisanymi plikami: do 40 pozycji i 300 MB po rozpakowaniu
 * (limit sprawdzany z nagłówków, zanim cokolwiek zostanie rozpakowane). Nazwy bez katalogów.
 */
export async function extractSignedZip(file: File): Promise<ExtractedFile[]> {
  if (file.size > SIGNED_ZIP_MAX_BYTES) {
    throw new Error(`${file.name}: archiwum większe niż ${formatFileSize(SIGNED_ZIP_MAX_BYTES)}`);
  }
  const raw = new Uint8Array(await file.arrayBuffer());
  const scan: { count: number; total: number; error: string | null } = { count: 0, total: 0, error: null };
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(raw, {
      filter: (info) => {
        if (scan.error || isSkippedEntry(info.name)) return false;
        scan.count += 1;
        scan.total += info.originalSize;
        if (scan.count > SIGNED_ZIP_MAX_ENTRIES) {
          scan.error = `w archiwum jest więcej niż ${SIGNED_ZIP_MAX_ENTRIES} plików`;
        } else if (scan.total > SIGNED_ZIP_MAX_BYTES) {
          scan.error = `pliki po rozpakowaniu przekraczają ${formatFileSize(SIGNED_ZIP_MAX_BYTES)}`;
        }
        return !scan.error;
      },
    });
  } catch {
    throw new Error(`${file.name}: nie udało się rozpakować archiwum (uszkodzone albo zaszyfrowane)`);
  }
  if (scan.error) throw new Error(`${file.name}: ${scan.error}`);
  return Object.entries(unzipped).map(([path, data]) => ({ name: path.split('/').pop() ?? path, data }));
}

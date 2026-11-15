import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { errorMessage } from '@/lib/errors';
import {
  DETACHED_SIGNATURE_MAX_BYTES,
  SIGNING_BUCKET,
  SIGNING_FILE_MAX_BYTES,
  fileExtension,
  formatFileSize,
  isOriginalExtension,
  isSignatureExtension,
  mimeForExtension,
  originalStoragePath,
  sha256Hex,
  signedStoragePath,
  type SigningFileKind,
} from '@/lib/signing';

/** Kształt `p_file` / `file` w RPC obiegu. */
export interface SigningFilePayload {
  file_id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
}

/** Zawartość pliku (żądanie z tokenem sesji, bez publicznego linku) - podgląd, ZIP, zapis na dysku. */
export async function fetchSigningFileBlob(storagePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(SIGNING_BUCKET).download(storagePath);
  if (error || !data) throw new Error(`Nie udało się pobrać pliku: ${errorMessage(error, 'brak pliku')}`);
  return data;
}

/** Zapis blobu na dysku przez tymczasowy link (wzór CaseAttachments). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Pobranie pliku dokumentu na dysk; `isPending` steruje przyciskiem "Pobierz". */
export function useDownloadSigningFile() {
  return useMutation({
    mutationFn: async ({ storagePath, filename }: { storagePath: string; filename: string }) => {
      saveBlob(await fetchSigningFileBlob(storagePath), filename);
    },
  });
}

async function uploadObject(path: string, body: Blob, contentType: string): Promise<void> {
  const { error } = await supabase.storage
    .from(SIGNING_BUCKET)
    .upload(path, body, { contentType, upsert: false, cacheControl: '3600' });
  if (error) throw new Error(`Nie udało się wgrać pliku: ${errorMessage(error)}`);
}

/**
 * Wgrywa oryginał (PDF/DOCX) pod `{document_id}/oryginal/v{n}-{file_id}.{ext}` i zwraca opis pliku do RPC.
 * Obiekt bez wiersza w bazie (np. odrzucony przez RPC) zostaje sierotą - sprząta go cron.
 */
export async function uploadOriginalFile(documentId: string, version: number, file: File): Promise<SigningFilePayload> {
  const ext = fileExtension(file.name);
  if (!isOriginalExtension(ext)) throw new Error(`${file.name}: dozwolone są tylko pliki PDF i DOCX`);
  if (file.size <= 0) throw new Error(`${file.name}: plik jest pusty`);
  if (file.size > SIGNING_FILE_MAX_BYTES) {
    throw new Error(`${file.name}: plik większy niż ${formatFileSize(SIGNING_FILE_MAX_BYTES)}`);
  }
  const mime = mimeForExtension(ext)!;
  const fileId = crypto.randomUUID();
  const path = originalStoragePath(documentId, version, fileId, ext);
  const sha256 = await sha256Hex(file);
  await uploadObject(path, file, mime);
  return { file_id: fileId, storage_path: path, filename: file.name.slice(0, 255), mime_type: mime, size_bytes: file.size, sha256 };
}

/** Wgrywa plik podpisu pod `{document_id}/podpisane/v{n}-{file_id}.{ext}` (wersja = bieżąca dokumentu). */
export async function uploadSignedFile(input: {
  documentId: string;
  version: number;
  kind: Exclude<SigningFileKind, 'oryginal'>;
  filename: string;
  data: Blob;
  sha256?: string;
}): Promise<SigningFilePayload> {
  const { documentId, version, kind, filename, data } = input;
  const ext = fileExtension(filename);
  if (!isSignatureExtension(ext)) throw new Error(`${filename}: niedozwolony typ pliku podpisu`);
  const limit = kind === 'podpis_zewnetrzny' ? DETACHED_SIGNATURE_MAX_BYTES : SIGNING_FILE_MAX_BYTES;
  if (data.size <= 0) throw new Error(`${filename}: plik jest pusty`);
  if (data.size > limit) throw new Error(`${filename}: plik większy niż ${formatFileSize(limit)}`);
  const mime = mimeForExtension(ext)!;
  const fileId = crypto.randomUUID();
  const path = signedStoragePath(documentId, version, fileId, ext);
  const sha256 = input.sha256 ?? (await sha256Hex(data));
  const body = data.type === mime ? data : new Blob([data], { type: mime });
  await uploadObject(path, body, mime);
  return { file_id: fileId, storage_path: path, filename: filename.slice(0, 255), mime_type: mime, size_bytes: data.size, sha256 };
}

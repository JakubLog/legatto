import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Obrazy newslettera: bucket `newsletter-assets` (publiczny, zapis writer + aal2 we własnym folderze).
// Ścieżka {userId}/{sha256}.{ext} - nazwa z treści pliku: ten sam obraz wgrany ponownie to ten sam
// obiekt (duplikat = sukces). Szablon trzyma publiczny URL Storage; przy stronie posła
// (public_site_url) mail i wersja online wskazują kopię na stronie /n/a/<sha256>.<ext>
// (render.ts, generator strony kopiuje obiekty wymienione w html_web).

const BUCKET = 'newsletter-assets';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB - musi byc spojne z migracja
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export interface UploadNewsletterAssetResult {
  path: string;
  public_url: string;
  mime: string;
}

/** sha256 treści pliku (hex, małe litery) - WebCrypto. */
export async function sha256Hex(data: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Ścieżka obiektu w buckecie dla pliku (folder użytkownika wymagany przez politykę Storage). */
export async function newsletterAssetPath(userId: string, file: File): Promise<string> {
  const ext = EXT_BY_MIME[file.type];
  if (!ext) throw new Error('Dozwolone formaty: JPG, PNG, WebP, GIF');
  return `${userId}/${await sha256Hex(file)}.${ext}`;
}

/** Storage odrzuca upload istniejącego obiektu (upsert: false) kodem 409 / „Duplicate”. */
function isDuplicateError(error: { message?: string; status?: number; statusCode?: string }): boolean {
  return error.statusCode === '409' || error.status === 409 || /already exists|duplicate/i.test(error.message ?? '');
}

export function useUploadNewsletterAsset() {
  return useMutation({
    mutationFn: async ({
      userId,
      file,
    }: {
      userId: string;
      file: File;
    }): Promise<UploadNewsletterAssetResult> => {
      if (file.size > MAX_BYTES) {
        throw new Error('Plik za duży (max 5 MB)');
      }
      const path = await newsletterAssetPath(userId, file);
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error && !isDuplicateError(error)) throw error;

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      if (!data?.publicUrl) {
        throw new Error('Nie udało się wygenerować publicznego URL');
      }
      return { path, public_url: data.publicUrl, mime: file.type };
    },
  });
}

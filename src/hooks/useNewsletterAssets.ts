import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const BUCKET = 'newsletter-assets';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB - musi byc spojne z migracja
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface UploadNewsletterAssetResult {
  path: string;
  public_url: string;
  mime: string;
}

function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return base.length > 80 ? base.slice(0, 80) : base;
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
      if (!ALLOWED_MIME.includes(file.type)) {
        throw new Error(`Dozwolone formaty: ${ALLOWED_MIME.join(', ')}`);
      }
      if (file.size > MAX_BYTES) {
        throw new Error('Plik za duży (max 5 MB)');
      }
      const safeName = slugify(file.name) || 'image';
      const path = `${userId}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      if (!data?.publicUrl) {
        throw new Error('Nie udało się wygenerować publicznego URL');
      }
      return { path, public_url: data.publicUrl, mime: file.type };
    },
  });
}

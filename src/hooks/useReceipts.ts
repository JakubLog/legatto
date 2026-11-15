import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  RECEIPT_ALLOWED_MIME,
  RECEIPT_MAX_BYTES,
  isAllowedReceiptMime,
  slugifyReceiptFilename,
} from '@/lib/expenses';

export interface UploadReceiptResult {
  path: string;
  mime: string;
}

export function useUploadReceipt() {
  return useMutation({
    mutationFn: async ({
      userId,
      file,
    }: {
      userId: string;
      file: File;
    }): Promise<UploadReceiptResult> => {
      if (!isAllowedReceiptMime(file.type)) {
        throw new Error(`Dozwolone formaty: ${RECEIPT_ALLOWED_MIME.join(', ')}`);
      }
      if (file.size > RECEIPT_MAX_BYTES) {
        throw new Error('Plik za duzy (max 5 MB)');
      }
      const safeName = slugifyReceiptFilename(file.name);
      const path = `${userId}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage
        .from('receipts')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      return { path, mime: file.type };
    },
  });
}

export function useDeleteReceipt() {
  return useMutation({
    mutationFn: async (path: string) => {
      const { error } = await supabase.storage.from('receipts').remove([path]);
      if (error) throw error;
    },
  });
}

// Signed URL dla bucketu prywatnego. 1h expiracja - po przeladowaniu odswiezy.
export function useReceiptSignedUrl(path: string | null | undefined, expiresIn = 3600) {
  return useQuery<string | null>({
    queryKey: ['receipt-url', path, expiresIn],
    enabled: Boolean(path),
    queryFn: async () => {
      if (!path) return null;
      const { data, error } = await supabase.storage
        .from('receipts')
        .createSignedUrl(path, expiresIn);
      if (error) throw error;
      return data.signedUrl;
    },
    staleTime: (expiresIn - 300) * 1000, // odswiez 5 min przed expiracja
    gcTime: expiresIn * 1000,
  });
}

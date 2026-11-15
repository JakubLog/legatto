import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { parseSiteContent, type SiteContent } from '@/lib/siteContent';

// Treść publicznej strony (tożsamość posła + strona główna).
// Odczyt: RPC get_public_site_content() - dostępne dla anon (SECURITY DEFINER, zwraca tylko te 2 klucze).
// Zapis: UPDATE app_settings (policy app_settings_update_posel: Poseł/administrator + aal2), audyt triggerem.
// Wymaga migracji 20261104100000_site_content.sql.

export const SITE_CONTENT_QUERY_KEY = ['site-content'] as const;

export function useSiteContent() {
  return useQuery<SiteContent>({
    queryKey: SITE_CONTENT_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_public_site_content');
      if (error) throw error;
      return parseSiteContent(data);
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpdateSiteContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: SiteContent) => {
      const rows = [
        { key: 'site_identity', value: content.identity },
        { key: 'homepage', value: content.homepage },
      ];
      for (const row of rows) {
        const { data, error } = await supabase
          .from('app_settings')
          .update({ value: row.value as unknown as Record<string, unknown> })
          .eq('key', row.key)
          .select('key');
        if (error) throw error;
        // RLS bez uprawnień zwraca 0 wierszy zamiast błędu.
        if (!data?.length) throw new Error('Brak uprawnień do zapisu treści strony');
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SITE_CONTENT_QUERY_KEY });
    },
  });
}

// Zdjęcia strony publicznej: bucket `site-assets` (publiczny, zapis tylko Poseł/administrator + aal2).
// Path: homepage/{timestamp}.{ext} - nowy plik przy każdym uploadzie (cache buster).
const SITE_ASSET_MAX_BYTES = 5 * 1024 * 1024;
const SITE_ASSET_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function useUploadSiteAsset() {
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      if (!SITE_ASSET_ALLOWED_TYPES.includes(file.type)) {
        throw new Error('Dozwolone formaty: JPG, PNG, WebP');
      }
      if (file.size > SITE_ASSET_MAX_BYTES) {
        throw new Error('Plik za duży (max 5 MB)');
      }
      const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1];
      const path = `homepage/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from('site-assets')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      return supabase.storage.from('site-assets').getPublicUrl(path).data.publicUrl;
    },
  });
}

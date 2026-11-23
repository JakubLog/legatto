import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// Statyczna strona posła (A6, migracja 20261121220000_site_publish.sql).
//
// - app_settings.public_site_url: origin strony posła (https://host[:port]) albo '' (tryb Vercel:
//   stronę główną i wersje online newslettera serwuje portal). Odczyt RPC public_site_url() (każdy
//   zalogowany; zwraca '' przy niepoprawnej wartości), zapis UPDATE app_settings (Poseł/Administrator
//   + aal2, walidację powtarza trigger app_settings_public_site_url_check).
// - Publikacja: request_site_publish() dopisuje job do kolejki (jeden oczekujący job wystarcza),
//   generator na serwerze biura (legatto-site-publish) buduje stronę i wdraża ją na Cloudflare Pages.
// - Stan: get_site_publish_status() - ostatni zakończony job, ostatni sukces, oczekujące (writer + aal2).

export type SitePublishReason = 'manual' | 'newsletter' | 'daily';
export type SitePublishJobStatus = 'queued' | 'running' | 'ok' | 'failed';

export interface SitePublishJob {
  id: string;
  reason: SitePublishReason;
  status: SitePublishJobStatus;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  deployment_id: string | null;
  error: string | null;
}

export interface SitePublishStatus {
  public_site_url: string;
  last: SitePublishJob | null;
  last_ok_at: string | null;
  pending: SitePublishJob[];
}

/** Ten sam wzorzec co public_site_url() i trigger w bazie: tylko origin https, bez ścieżki. */
export const PUBLIC_SITE_URL_RE = /^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/;

/**
 * Normalizuje wpisany adres strony posła do originu (małe litery, bez końcowego ukośnika).
 * Zwraca '' dla pustego pola albo null, gdy adres nie jest originem https.
 */
export function normalizePublicSiteUrl(input: string): string | null {
  const value = input.trim().replace(/\/+$/, '');
  if (!value) return '';
  const lower = value.toLowerCase();
  return PUBLIC_SITE_URL_RE.test(lower) ? lower : null;
}

export const PUBLIC_SITE_URL_QUERY_KEY = ['public-site-url'] as const;
export const SITE_PUBLISH_STATUS_QUERY_KEY = ['site-publish-status'] as const;

/** Opcje zapytania o public_site_url - także dla `queryClient.fetchQuery` poza komponentami. */
export const publicSiteUrlQuery = {
  queryKey: PUBLIC_SITE_URL_QUERY_KEY,
  queryFn: async (): Promise<string> => {
    const { data, error } = await supabase.rpc('public_site_url');
    if (error) throw error;
    return typeof data === 'string' ? data : '';
  },
  staleTime: 5 * 60_000,
};

/** Origin strony posła ('' = brak strony statycznej, tryb Vercel). */
export function usePublicSiteUrl() {
  return useQuery(publicSiteUrlQuery);
}

const PENDING_POLL_MS = 5_000;

export function useSitePublishStatus(enabled = true) {
  return useQuery<SitePublishStatus | null>({
    queryKey: SITE_PUBLISH_STATUS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_site_publish_status');
      if (error) throw error;
      // null = brak uprawnień (writer + aal2).
      if (!data) return null;
      const raw = data as Partial<SitePublishStatus>;
      return {
        public_site_url: typeof raw.public_site_url === 'string' ? raw.public_site_url : '',
        last: raw.last ?? null,
        last_ok_at: raw.last_ok_at ?? null,
        pending: Array.isArray(raw.pending) ? raw.pending : [],
      };
    },
    enabled,
    // Odpytywanie tylko, gdy w kolejce czeka job (publikacja trwa zwykle 1-3 min).
    refetchInterval: (query) => ((query.state.data?.pending.length ?? 0) > 0 ? PENDING_POLL_MS : false),
    refetchIntervalInBackground: false,
  });
}

export function useRequestSitePublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc('request_site_publish');
      if (error) throw error;
      return data as string;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: SITE_PUBLISH_STATUS_QUERY_KEY });
    },
  });
}

/** Zgłasza publikację strony i pokazuje wynik w toaście (karta publikacji, edytor strony, blog). */
export function useSitePublishAction() {
  const requestMut = useRequestSitePublish();
  const publish = async () => {
    try {
      await requestMut.mutateAsync();
      toast.success('Publikacja strony zgłoszona', {
        description: 'Serwer biura zbuduje i wdroży stronę w ciągu kilku minut.',
      });
    } catch (err) {
      toast.error('Nie udało się zgłosić publikacji', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };
  return { publish, pending: requestMut.isPending };
}

export function useUpdatePublicSiteUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: string): Promise<string> => {
      const value = normalizePublicSiteUrl(input);
      if (value === null) {
        throw new Error('Podaj adres w postaci https://domena (bez ścieżki) albo zostaw puste pole');
      }
      const { data, error } = await supabase
        .from('app_settings')
        .update({ value })
        .eq('key', 'public_site_url')
        .select('key');
      if (error) throw error;
      // RLS bez uprawnień zwraca 0 wierszy zamiast błędu.
      if (!data?.length) throw new Error('Brak uprawnień do zapisu adresu strony');
      return value;
    },
    onSuccess: (value) => {
      qc.setQueryData(PUBLIC_SITE_URL_QUERY_KEY, value);
      void qc.invalidateQueries({ queryKey: SITE_PUBLISH_STATUS_QUERY_KEY });
    },
  });
}

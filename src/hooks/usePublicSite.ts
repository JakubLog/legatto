import { useQuery } from '@tanstack/react-query';
import { DEFAULT_SITE_CONTENT } from '@/lib/siteContent';
import { publicSiteSchema, type PublicSiteData } from '@/lib/siteSnapshot';

// Dane publicznej strony głównej SPA (tryb Vercel i podgląd w CRM) oraz marki posła na ekranach
// logowania: migawka z GET /api/public-site (api/public-site.ts, service_site_snapshot kluczem
// service_role). Anon nie czyta już bazy bezpośrednio (get_public_* odebrane).
// Strona statyczna posła (site/) dostaje te same dane w buildzie, bez tego hooka.

export const PUBLIC_SITE_QUERY_KEY = ['public-site'] as const;

/** Treść neutralna (błąd odczytu): strona dalej działa na domyślnych tekstach, bez biur i wydarzeń. */
export const EMPTY_PUBLIC_SITE: PublicSiteData = {
  schema_version: 1,
  generated_at: new Date(0).toISOString(),
  public_site_url: '',
  identity: DEFAULT_SITE_CONTENT.identity,
  homepage: DEFAULT_SITE_CONTENT.homepage,
  district: null,
  offices: [],
  staff: [],
  events: [],
  dictionaries: { powiaty: [], gminy: [], categories: [] },
};

export async function fetchPublicSite(): Promise<PublicSiteData> {
  const res = await fetch('/api/public-site', { headers: { Accept: 'application/json' } });
  if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`Nie udało się pobrać danych strony (${res.status})`);
  }
  return publicSiteSchema.parse(await res.json());
}

export function usePublicSite() {
  return useQuery<PublicSiteData>({
    queryKey: PUBLIC_SITE_QUERY_KEY,
    queryFn: fetchPublicSite,
    staleTime: 60_000,
    retry: 1,
  });
}

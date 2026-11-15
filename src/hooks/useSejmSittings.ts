import { useQuery } from '@tanstack/react-query';

/** Posiedzenie Sejmu z `/api/sejm-sittings`; `number === 0` = posiedzenie planowane. */
export interface SejmSitting {
  number: number;
  /** Dni posiedzenia, `yyyy-MM-dd`. */
  dates: string[];
  current: boolean;
}

// Posiedzenia bieżącej kadencji (proxy api.sejm.gov.pl, cache CDN; lokalnie middleware
// w vite.config.ts). Przy błędzie kalendarz pokazuje tylko wydarzenia biura.
export function useSejmSittings() {
  return useQuery<SejmSitting[]>({
    queryKey: ['sejm-sittings'],
    queryFn: async () => {
      const res = await fetch('/api/sejm-sittings', { headers: { Accept: 'application/json' } });
      if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) {
        throw new Error(`Nie udało się pobrać posiedzeń Sejmu (${res.status})`);
      }
      const body = (await res.json()) as { sittings: SejmSitting[] };
      return body.sittings;
    },
    staleTime: 60 * 60_000,
    retry: 1,
  });
}

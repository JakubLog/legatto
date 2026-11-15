import { useQuery } from '@tanstack/react-query';
import type { FeatureCollection } from 'geojson';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

// Okręg wyborczy instancji (jedna instancja = jeden poseł = jeden okręg).
// Konfiguracja: app_settings.district = { number, highlighted_powiat_id, highlighted_gmina_id, highlight_label }.
// Odczyt: RPC get_public_district() - dostępne dla anon (SECURITY DEFINER, zwraca tylko ten klucz),
// bo mapę biur pokazuje też publiczna strona główna. Migracja 20261107110000_district_settings.sql.
// Granice: public/geo/okreg-<number>-{powiaty,gminy}.geojson ze scripts/build-okreg-geojson.mjs;
// słowniki powiaty/gminy w bazie muszą mieć te same id (seed z tego samego skryptu).

const districtSchema = z.object({
  number: z.number().int().min(1).max(41),
  highlighted_powiat_id: z.number().int().nullable().catch(null),
  highlighted_gmina_id: z.number().int().nullable().catch(null),
  highlight_label: z.string().trim().max(80).catch(''),
});
export type DistrictConfig = z.infer<typeof districtSchema>;

export function useDistrictConfig() {
  return useQuery<DistrictConfig | null>({
    queryKey: ['district-config'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_public_district');
      if (error) throw error;
      // Brak klucza lub niepoprawny numer = instancja bez skonfigurowanego okręgu (null).
      const parsed = districtSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
    staleTime: 5 * 60_000,
  });
}

export type DistrictGeoLevel = 'powiaty' | 'gminy';

/**
 * Granice okręgu z public/geo/. `null` = brak pliku dla tego okręgu (komunikat "Brak mapy okręgu");
 * SPA rewrite na Vercel/Vite zwraca wtedy index.html z HTTP 200, więc liczy się treść, nie sam status.
 */
export function useDistrictGeo(number: number | null | undefined, level: DistrictGeoLevel) {
  return useQuery<FeatureCollection | null>({
    queryKey: ['geojson', number, level],
    enabled: number != null,
    queryFn: async () => {
      const url = `/geo/okreg-${number}-${level}.geojson`;
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Nie udało się pobrać ${url} (HTTP ${res.status})`);
      let data: unknown;
      try {
        data = JSON.parse(await res.text());
      } catch {
        return null;
      }
      const fc = data as Partial<FeatureCollection> | null;
      return fc?.type === 'FeatureCollection' && Array.isArray(fc.features) ? (fc as FeatureCollection) : null;
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

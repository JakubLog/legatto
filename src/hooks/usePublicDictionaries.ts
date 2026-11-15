import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CaseCategory, Gmina, Powiat } from '@/integrations/supabase/types';

// Słowniki publiczne dla formularza zgłoszeń (anon read).
// Powiaty - 12 wpisów; Gminy - 61; Kategorie - 10 systemowych.
// staleTime: Infinity bo to praktycznie immutable dane (zmiana wymaga migracji).

export function usePublicPowiaty() {
  return useQuery<Powiat[]>({
    queryKey: ['public', 'powiaty'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('powiaty')
        .select('id, name, is_city, lat, lng')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Powiat[];
    },
    staleTime: Infinity,
  });
}

export function usePublicGminy(powiatId?: number | null) {
  return useQuery<Gmina[]>({
    queryKey: ['public', 'gminy', powiatId ?? 'all'],
    queryFn: async () => {
      let query = supabase
        .from('gminy')
        .select('id, powiat_id, name, type')
        .order('name');
      if (powiatId != null) {
        query = query.eq('powiat_id', powiatId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Gmina[];
    },
    staleTime: Infinity,
    enabled: powiatId != null,
  });
}

export function usePublicCategories() {
  return useQuery<CaseCategory[]>({
    queryKey: ['public', 'case_categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_categories')
        .select('id, name, slug, color, is_system, created_by, created_at')
        .eq('is_system', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as CaseCategory[];
    },
    staleTime: Infinity,
  });
}

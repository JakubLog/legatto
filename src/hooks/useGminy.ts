import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Gmina } from '@/integrations/supabase/types';

export function useGminy(powiatId?: number | null) {
  return useQuery<Gmina[]>({
    queryKey: ['gminy', powiatId ?? 'all'],
    queryFn: async () => {
      let query = supabase
        .from('gminy')
        .select('id, powiat_id, name, type')
        .order('name');
      if (powiatId !== undefined && powiatId !== null) {
        query = query.eq('powiat_id', powiatId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Gmina[];
    },
    staleTime: Infinity,
  });
}

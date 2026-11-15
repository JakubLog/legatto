import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Powiat } from '@/integrations/supabase/types';

export function usePowiaty() {
  return useQuery<Powiat[]>({
    queryKey: ['powiaty'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('powiaty')
        .select('id, name, is_city, lat, lng')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Powiat[];
    },
    staleTime: Infinity, // słownik praktycznie się nie zmienia
  });
}

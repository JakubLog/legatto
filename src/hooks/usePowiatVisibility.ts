import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { PowiatVisibilityStats } from '@/integrations/supabase/types';

export function usePowiatVisibility() {
  return useQuery<PowiatVisibilityStats[]>({
    queryKey: ['powiat-visibility'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('powiat_visibility_stats')
        .select('powiat_id, powiat_name, is_city, lat, lng, contacts_count, events_count, last_event_at, days_since_last_event')
        .order('powiat_name');
      if (error) throw error;
      return (data ?? []) as PowiatVisibilityStats[];
    },
    staleTime: 60_000,
  });
}

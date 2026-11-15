import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useAppSetting<T>(key: string, defaultValue: T) {
  return useQuery<T>({
    queryKey: ['app-setting', key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();
      if (error) throw error;
      if (!data) return defaultValue;
      return data.value as T;
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpdateAppSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      // Upsert na wypadek gdyby setting nie istniał w DB
      const { error } = await supabase
        .from('app_settings')
        .upsert({ key, value }, { onConflict: 'key' });
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['app-setting', variables.key] });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ModuleOwner, OwnedModule } from '@/integrations/supabase/types';

const MODULE_OWNERS_KEY = ['module-owners'] as const;

/** Opiekunowie modułów z `module_owners` (wg pozycji). */
export function useModuleOwners() {
  return useQuery<ModuleOwner[]>({
    queryKey: MODULE_OWNERS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('module_owners')
        .select('module, user_id, position, user:profiles(id, full_name, avatar_url, is_active)')
        .order('module')
        .order('position');
      if (error) throw error;
      return (data ?? []) as unknown as ModuleOwner[];
    },
    staleTime: 5 * 60_000,
  });
}

/** Zastępuje opiekunów modułu (1-2 osoby). Walidacja, uprawnienia i audyt w RPC `set_module_owners`. */
export function useSetModuleOwners() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ module, userIds }: { module: OwnedModule; userIds: string[] }) => {
      const { error } = await supabase.rpc('set_module_owners', {
        p_module: module,
        p_user_ids: userIds,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MODULE_OWNERS_KEY });
    },
  });
}

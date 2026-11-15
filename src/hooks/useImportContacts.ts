import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ContactType } from '@/integrations/supabase/types';

export interface ImportRow {
  type: ContactType;
  first_name: string;
  last_name: string;
  function: string | null;
  phone: string | null;
  email: string | null;
  powiat_id: number;
  gmina_id: number | null;
  miejscowosc: string | null;
  street: string | null;
  postal_code: string | null;
  notes: string | null;
}

export interface ImportResult {
  imported: number;
  failed: number;
}

export function useImportContacts() {
  const qc = useQueryClient();
  return useMutation<ImportResult, Error, ImportRow[]>({
    mutationFn: async (rows) => {
      const { data, error } = await supabase.from('contacts').insert(rows).select('id');
      if (error) throw error;
      return { imported: data?.length ?? 0, failed: 0 };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contacts-stats'] });
    },
  });
}

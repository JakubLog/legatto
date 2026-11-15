import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

/** Rodzaje rekordów obsługiwane przez kosz (`trash_entities.entity` w bazie). */
export type TrashEntity =
  | 'case'
  | 'case_attachment'
  | 'case_comment'
  | 'contact'
  | 'interpellation'
  | 'expense'
  | 'budget_report'
  | 'signing_document';

export const TRASH_ENTITY_LABELS: Record<TrashEntity, string> = {
  case: 'Sprawa',
  case_attachment: 'Załącznik sprawy',
  case_comment: 'Komentarz',
  contact: 'Kontakt',
  interpellation: 'Interpelacja',
  expense: 'Wydatek',
  budget_report: 'Raport budżetu',
  signing_document: 'Dokument do podpisu',
};

export interface TrashItem {
  group_id: string;
  entity: TrashEntity;
  title: string | null;
  context: string | null;
  deleted_at: string;
  purge_after: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
  /** Rekordy usunięte razem z pozycją (np. załączniki i komentarze sprawy). */
  items: number;
  files: number;
}

interface RestoreResult {
  entity: TrashEntity;
  id: string;
}

const TRASH_KEY = ['trash'] as const;

export function useTrash() {
  return useQuery<TrashItem[]>({
    queryKey: TRASH_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('trash_list');
      if (error) throw error;
      return (data ?? []) as TrashItem[];
    },
    staleTime: 10_000,
  });
}

// Przywrócony rekord wraca do swojego modułu (i do list zależnych, np. kontakt przy sprawie),
// więc odświeżamy wszystkie zapytania zamiast utrzymywać mapę encja → klucze.
const refreshAll = (qc: QueryClient) => qc.invalidateQueries();

export function useRestoreTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string) => {
      const { data, error } = await supabase.rpc('trash_restore', { p_group_id: groupId });
      if (error) throw error;
      return data as RestoreResult;
    },
    onSuccess: () => refreshAll(qc),
  });
}

export function usePurgeTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase.rpc('trash_purge', { p_group_id: groupId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TRASH_KEY }),
  });
}

export function useEmptyTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('trash_empty');
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TRASH_KEY }),
  });
}

/**
 * Toast po usunięciu rekordu: informacja o koszu + „Cofnij” (przywrócenie ostatniego usunięcia
 * tego rekordu). Używany przez okna usuwania wszystkich modułów objętych koszem.
 */
export function useMovedToTrashToast() {
  const qc = useQueryClient();
  return (entity: TrashEntity, rowId: string, message = 'Przeniesiono do kosza') => {
    void qc.invalidateQueries({ queryKey: TRASH_KEY });
    toast.success(message, {
      description: 'Możesz przywrócić w ciągu 7 dni (Kosz).',
      action: {
        label: 'Cofnij',
        onClick: async () => {
          const { error } = await supabase.rpc('trash_restore_row', { p_entity: entity, p_row_id: rowId });
          if (error) {
            toast.error('Nie udało się przywrócić', { description: error.message });
            return;
          }
          toast.success('Przywrócono');
          await refreshAll(qc);
        },
      },
    });
  };
}

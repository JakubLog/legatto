import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { invalidateCaseHistory } from '@/hooks/useCaseHistory';
import { OPEN_CASE_STATUSES } from '@/lib/cases';
import { isAdmin } from '@/lib/permissions';
import type {
  AppRole,
  Case,
  CasePriority,
  CaseSource,
  CaseStatus,
  CaseWithRelations,
} from '@/integrations/supabase/types';

/** `open` - wszystkie poza załatwionymi i odrzuconymi (domyślny widok listy). */
export type CasesStatusFilter = CaseStatus | 'open';

export interface CasesFilters {
  status?: CasesStatusFilter | null;
  priority?: CasePriority | null;
  categoryId?: number | null;
  assignedTo?: string | null;
  source?: CaseSource | null;
  search?: string;
}

/**
 * Domyślne filtry listy spraw: bez zakończonych; osoba spoza Posła/administratora zaczyna
 * w trybie „Moje sprawy” (przypisane do niej; wyłączenie pokazuje wszystko z jej zakresu danych).
 */
export function defaultCasesFilters(profile: { id: string; role: AppRole } | null): CasesFilters {
  return {
    status: 'open',
    priority: null,
    categoryId: null,
    assignedTo: profile && !isAdmin(profile.role) ? profile.id : null,
    source: null,
    search: '',
  };
}

const SELECT_WITH_RELATIONS = `
  id, title, description, status, priority,
  category_id, contact_id, reporter_name, reporter_phone, reporter_email,
  powiat_id, gmina_id, assigned_to,
  due_date, resolved_at, resolution_notes,
  source, consent_newsletter, consent_contacts_db,
  submission_ip_hash, submission_user_agent,
  created_by, created_at, updated_at,
  category:case_categories(id, name, color),
  contact:contacts(id, first_name, last_name, phone, email),
  powiat:powiaty(id, name),
  gmina:gminy(id, name),
  assigned:profiles!cases_assigned_to_fkey(id, full_name, avatar_url),
  creator:profiles!cases_created_by_fkey(id, full_name, avatar_url)
`;

function escapeOrToken(input: string): string {
  return input.replace(/[\\,()]/g, '');
}

export function useCases(filters: CasesFilters = {}) {
  return useQuery<CaseWithRelations[]>({
    queryKey: [
      'cases',
      filters.status ?? null,
      filters.priority ?? null,
      filters.categoryId ?? null,
      filters.assignedTo ?? null,
      filters.source ?? null,
      (filters.search ?? '').trim().toLowerCase(),
    ],
    queryFn: async () => {
      let query = supabase
        .from('cases')
        .select(SELECT_WITH_RELATIONS)
        .order('created_at', { ascending: false })
        .limit(200);

      if (filters.status === 'open') query = query.in('status', OPEN_CASE_STATUSES);
      else if (filters.status) query = query.eq('status', filters.status);
      if (filters.priority) query = query.eq('priority', filters.priority);
      if (filters.categoryId !== undefined && filters.categoryId !== null) {
        query = query.eq('category_id', filters.categoryId);
      }
      if (filters.assignedTo !== undefined && filters.assignedTo !== null) {
        query = query.eq('assigned_to', filters.assignedTo);
      }
      if (filters.source) query = query.eq('source', filters.source);
      const search = (filters.search ?? '').trim();
      if (search.length >= 2) {
        const term = `%${escapeOrToken(search)}%`;
        query = query.or(`title.ilike.${term},description.ilike.${term}`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as CaseWithRelations[];
    },
    staleTime: 30_000,
  });
}

/**
 * Pojedyncza sprawa po id (deep-link `?open=<id>` z wyszukiwarki globalnej),
 * gdy rekord nie jest na aktualnie wczytanej liście. Brak dostępu (RLS) = `null`.
 */
export function useCase(id: string | null) {
  return useQuery<CaseWithRelations | null>({
    queryKey: ['cases', 'detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cases')
        .select(SELECT_WITH_RELATIONS)
        .eq('id', id ?? '')
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as CaseWithRelations | null;
    },
    enabled: Boolean(id),
    retry: false,
    staleTime: 30_000,
  });
}

// Pola wstawiane przez frontend (UI w portalu) - bez metadanych public_form, default DB.
export type CaseInput = Omit<
  Case,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'created_by'
  | 'resolved_at'
  | 'source'
  | 'consent_newsletter'
  | 'consent_contacts_db'
  | 'submission_ip_hash'
  | 'submission_user_agent'
>;

export function useCreateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CaseInput) => {
      const { data, error } = await supabase
        .from('cases')
        .insert(input)
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cases'] });
    },
  });
}

export function useUpdateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<CaseInput> & { id: string }) => {
      const { error } = await supabase.from('cases').update(patch).eq('id', id);
      if (error) throw error;
    },
    // Zwrócony promise: mutateAsync kończy się po odświeżeniu listy, więc edycja w miejscu
    // zamyka pole dopiero z nową wartością (bez mignięcia starej).
    onSuccess: (_data, { id }) => {
      invalidateCaseHistory(qc, id);
      return qc.invalidateQueries({ queryKey: ['cases'] });
    },
  });
}

/** Zapis wybranych pól sprawy z podglądu (edycja w miejscu). Błąd kończy się toastem, wynik: czy zapisano. */
export function useCasePatch(id: string) {
  const { mutateAsync, isPending } = useUpdateCase();
  const save = useCallback(
    async (patch: Partial<CaseInput>) => {
      try {
        await mutateAsync({ id, ...patch });
        return true;
      } catch (err) {
        toast.error('Nie udało się zapisać zmiany', {
          description: err instanceof Error ? err.message : undefined,
        });
        return false;
      }
    },
    [id, mutateAsync],
  );
  return { save, isPending };
}

export function useDeleteCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cases').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cases'] });
    },
  });
}

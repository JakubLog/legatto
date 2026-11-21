import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  InterpellationDecision,
  InterpellationListItem,
  InterpellationWithRelations,
} from '@/integrations/supabase/types';

// Lista nie pobiera content_html/content_text (do kilkuset KB na wiersz).
const LIST_SELECT = `
  id, recipient, subject, review_notes, revision, case_id, signatory_id, status,
  submitted_at, decided_at, decided_by, accepted_at, deadline_at, sent_at, archived_at,
  created_by, created_at, updated_at,
  case:cases(id, title),
  creator:profiles!interpellations_created_by_fkey(id, full_name, avatar_url)
`;

const DETAIL_SELECT = `
  *,
  case:cases(id, title),
  creator:profiles!interpellations_created_by_fkey(id, full_name, avatar_url),
  signatory:profiles!interpellations_signatory_id_fkey(id, full_name, avatar_url, role),
  decider:profiles!interpellations_decided_by_fkey(id, full_name)
`;
const PAGE_SIZE = 500;

function invalidateInterpellations(qc: QueryClient, id?: string) {
  qc.invalidateQueries({ queryKey: ['interpellations'] });
  qc.invalidateQueries({ queryKey: ['dashboard', 'interpellations'] });
  if (id) qc.invalidateQueries({ queryKey: ['interpellation', id] });
  else qc.invalidateQueries({ queryKey: ['interpellation'] });
}

/** Odświeża UI po zmianach wykonanych poza aplikacją, szczególnie przez MCP. */
export function useInterpellationsRealtime(id?: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`interpellations-ui-${id ?? 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'interpellations',
          ...(id ? { filter: `id=eq.${id}` } : {}),
        },
        () => invalidateInterpellations(qc, id ?? undefined),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, qc]);
}

export function useInterpellations() {
  useInterpellationsRealtime();
  return useQuery<InterpellationListItem[]>({
    queryKey: ['interpellations'],
    queryFn: async ({ signal }) => {
      const items: InterpellationListItem[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('interpellations')
          .select(LIST_SELECT)
          .order('submitted_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + PAGE_SIZE - 1)
          .abortSignal(signal);
        if (error) throw error;
        const page = (data ?? []) as unknown as InterpellationListItem[];
        items.push(...page);
        if (page.length < PAGE_SIZE) return items;
      }
    },
    staleTime: 30_000,
  });
}

export function useInterpellation(id: string | null) {
  useInterpellationsRealtime(id);
  return useQuery<InterpellationWithRelations | null>({
    queryKey: ['interpellation', id],
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('interpellations')
        .select(DETAIL_SELECT)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as InterpellationWithRelations) ?? null;
    },
    staleTime: 30_000,
  });
}

/**
 * Decyzja Posła. Przejścia, znaczniki czasu (decided_at, accepted_at, deadline_at,
 * archived_at) i wymóg uwag przy `uwagi` egzekwuje trigger interpellations_workflow.
 */
export function useDecideInterpellation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision, notes }: { id: string; decision: InterpellationDecision; notes: string | null }) => {
      const { error } = await supabase
        .from('interpellations')
        .update({ status: decision, review_notes: notes })
        .eq('id', id)
        .in('status', ['nowa', 'po_poprawkach'])
        .select('id')
        .single();
      if (error) throw error;
    },
    onSuccess: (_, vars) => invalidateInterpellations(qc, vars.id),
  });
}

/** Zaakceptowana -> wysłana (Poseł, Administrator albo Pracownik). */
export function useMarkInterpellationSent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('interpellations')
        .update({ status: 'wyslana' })
        .eq('id', id)
        .eq('status', 'zaakceptowana')
        .select('id')
        .single();
      if (error) throw error;
    },
    onSuccess: (_, id) => invalidateInterpellations(qc, id),
  });
}

export function useDeleteInterpellation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('interpellations')
        .delete()
        .eq('id', id)
        .select('id')
        .single();
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: ['interpellation', id] });
      invalidateInterpellations(qc);
    },
  });
}

/**
 * Ręczne wgranie przez Pracownika (bez Claude/MCP): api/integracje.ts sanityzuje HTML, wyodrębnia
 * tekst i audytuje tak samo jak narzędzia MCP interpellations_submit / interpellations_resubmit.
 */
async function postInterpellation(op: 'interpellation_submit' | 'interpellation_resubmit', body: Record<string, unknown>) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Brak aktywnej sesji');
  const res = await fetch(`/api/integracje?op=${op}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { interpellation?: { id: string }; error?: string; message?: string };
  if (!res.ok || !data.interpellation) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
  return data.interpellation;
}

export interface InterpellationUpload {
  recipient: string;
  subject: string;
  html: string;
}

/** Nowa interpelacja (status "Nowa"). Zwraca id. */
export function useSubmitInterpellation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: InterpellationUpload & { case_id?: string | null }) =>
      (await postInterpellation('interpellation_submit', { ...input })).id,
    onSuccess: (id) => invalidateInterpellations(qc, id),
  });
}

/** Poprawiona wersja po uwagach ("Uwagi" -> "Po poprawkach"). */
export function useResubmitInterpellation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: InterpellationUpload & { id: string }) =>
      (await postInterpellation('interpellation_resubmit', { ...input })).id,
    onSuccess: (id) => invalidateInterpellations(qc, id),
  });
}

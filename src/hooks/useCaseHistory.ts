import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CaseActivity, CaseComment } from '@/integrations/supabase/types';

// Historia sprawy: dziennik zdarzeń (`case_activity`, zapisują go triggery na `cases` i
// `case_attachments`) + komentarze (`case_comments`). Oba odczyty przez RLS widoczności sprawy.

export const caseHistoryKey = (caseId: string) => ['case-history', caseId] as const;

/** Odświeża historię po zmianie sprawy (status, przypisanie, załączniki) - bez id: wszystkie. */
export function invalidateCaseHistory(qc: QueryClient, caseId?: string) {
  qc.invalidateQueries({ queryKey: caseId ? caseHistoryKey(caseId) : ['case-history'] });
}

export function useCaseActivity(caseId: string | null) {
  return useQuery<CaseActivity[]>({
    queryKey: [...caseHistoryKey(caseId ?? ''), 'activity'],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('case_activity')
        .select('id, case_id, kind, data, actor_id, created_at, actor:profiles!case_activity_actor_id_fkey(id, full_name, avatar_url)')
        .eq('case_id', caseId!)
        .order('created_at', { ascending: true })
        .limit(500)
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as unknown as CaseActivity[];
    },
    enabled: Boolean(caseId),
    staleTime: 15_000,
  });
}

export function useCaseComments(caseId: string | null) {
  return useQuery<CaseComment[]>({
    queryKey: [...caseHistoryKey(caseId ?? ''), 'comments'],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('case_comments')
        .select('id, case_id, author_id, body, mentions, created_at, author:profiles!case_comments_author_id_fkey(id, full_name, avatar_url)')
        .eq('case_id', caseId!)
        .order('created_at', { ascending: true })
        .limit(500)
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as unknown as CaseComment[];
    },
    enabled: Boolean(caseId),
    staleTime: 15_000,
  });
}

/** Id osób, które widzą sprawę (kandydaci do @wzmianki), bez mnie. */
export function useCaseMentionableUserIds(caseId: string | null, enabled = true) {
  return useQuery<Set<string>>({
    queryKey: [...caseHistoryKey(caseId ?? ''), 'mentionable'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_case_mentionable_users', { p_case_id: caseId! });
      if (error) throw error;
      return new Set(((data ?? []) as string[]).filter(Boolean));
    },
    enabled: Boolean(caseId) && enabled,
    staleTime: 60_000,
  });
}

/** Zmiany wykonane w innej karcie, przez współpracownika albo MCP. */
export function useCaseHistoryRealtime(caseId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!caseId) return;
    const refresh = () => invalidateCaseHistory(qc, caseId);
    const channel = supabase
      .channel(`case-history-${caseId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_comments', filter: `case_id=eq.${caseId}` }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'case_activity', filter: `case_id=eq.${caseId}` }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [caseId, qc]);
}

export function useAddCaseComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ caseId, body, mentions }: { caseId: string; body: string; mentions: string[] }) => {
      const { error } = await supabase.from('case_comments').insert({ case_id: caseId, body, mentions });
      if (error) throw error;
    },
    onSettled: (_data, _error, { caseId }) => invalidateCaseHistory(qc, caseId),
  });
}

export function useDeleteCaseComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; caseId: string }) => {
      const { data, error } = await supabase.from('case_comments').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Nie możesz usunąć tego komentarza.');
    },
    onSettled: (_data, _error, { caseId }) => invalidateCaseHistory(qc, caseId),
  });
}

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useGRNewsletters, useGRStatus } from '@/hooks/useGetResponse';
import { useNewsletterIssues } from '@/hooks/useNewsletterIssues';
import { canWrite } from '@/lib/permissions';
import { evaluateNewsletterSends, type NewsletterSends } from '@/lib/newsletterSends.utils';
import type { ModulePulse, OwnedModule, PersonPulseRow, PulseLevel } from '@/integrations/supabase/types';

/** Sygnały obszarów liczone w bazie (`get_module_pulse`): kalendarz, teren, interpelacje, budżet. */
export function useDbModulePulse() {
  return useQuery<ModulePulse[]>({
    queryKey: ['module-pulse'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_module_pulse');
      if (error) throw error;
      return (data ?? []) as ModulePulse[];
    },
    staleTime: 5 * 60_000,
  });
}

/** Trend aktywności osoby (`get_person_pulse`, tylko Poseł/Administrator). */
export function usePersonPulse(userId: string | null) {
  return useQuery<PersonPulseRow[]>({
    queryKey: ['person-pulse', userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_person_pulse', { p_user_id: userId });
      if (error) throw error;
      return (data ?? []) as PersonPulseRow[];
    },
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });
}

const LEVEL_RANK: Record<PulseLevel, number> = { ok: 0, warning: 1, critical: 2 };

/**
 * Wysyłki newslettera: historia GetResponse (gdy integracja aktywna) + wydania wysłane
 * z aplikacji (`newsletter_issues`). Oba źródła tylko dla ról z zapisem (getresponse-proxy
 * i RLS newsletter_issues wymagają is_writer); bez dostępu `sends` = undefined.
 */
function useNewsletterSends(enabled: boolean) {
  const { profile } = useAuth();
  const allowed = enabled && canWrite(profile?.role);
  const statusQ = useGRStatus(allowed);
  const grActive = allowed && statusQ.data?.ok === true;
  const newslettersQ = useGRNewsletters(grActive);
  const issuesQ = useNewsletterIssues(allowed);

  const sends = useMemo(
    () =>
      evaluateNewsletterSends(
        grActive ? newslettersQ.data : undefined,
        allowed ? issuesQ.data : undefined,
        Date.now(),
      ) ?? undefined,
    [grActive, allowed, newslettersQ.data, issuesQ.data],
  );
  return { sends, grUnavailable: !grActive && !(allowed && statusQ.isLoading) };
}

/** Wiersz newslettera z bazy (aktywność opiekuna) uzupełniony o regułę cotygodniowej wysyłki. */
function mergeNewsletter(row: ModulePulse | undefined, sends: NewsletterSends | undefined): ModulePulse | undefined {
  if (!row || !sends) return row;
  return {
    ...row,
    level: LEVEL_RANK[sends.level] > LEVEL_RANK[row.level] ? sends.level : row.level,
    recent_count: row.reasons === null ? null : sends.sentLast14Days,
    reasons: row.reasons === null ? null : [...(sends.reason ? [sends.reason] : []), ...row.reasons],
  };
}

/** Sygnał jednego obszaru (poświata awatarów). Zapytania GR tylko dla newslettera. */
export function useModulePulse(module: OwnedModule): ModulePulse | undefined {
  const db = useDbModulePulse();
  const { sends } = useNewsletterSends(module === 'newsletter');
  const row = db.data?.find((p) => p.module === module);
  return module === 'newsletter' ? mergeNewsletter(row, sends) : row;
}

/** Sygnały wszystkich obszarów (Puls Biura). */
export function useOfficePulse() {
  const db = useDbModulePulse();
  const { sends, grUnavailable } = useNewsletterSends(true);
  const data = useMemo(
    () => db.data?.map((row) => (row.module === 'newsletter' ? (mergeNewsletter(row, sends) as ModulePulse) : row)),
    [db.data, sends],
  );
  return { data, isLoading: db.isLoading, isError: db.isError, error: db.error, grUnavailable };
}

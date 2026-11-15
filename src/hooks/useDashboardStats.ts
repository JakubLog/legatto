import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  CasePriority,
  CaseStatus,
  EventType,
  InterpellationStatus,
} from '@/integrations/supabase/types';
import { useInterpellationsRealtime } from '@/hooks/useInterpellations';

export interface CasesStats {
  nowa: number;
  w_toku: number;
  oczekuje: number;
  załatwiona: number;
  odrzucona: number;
  urgent: number;
  high: number;
  /** Sprawy nie-rozwiązane z terminem w ciągu najbliższych 3 dni (dziś..+3). */
  due_soon: number;
  total: number;
}

export interface UpcomingEvent {
  id: string;
  title: string;
  type: EventType;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
}

export interface RecentCase {
  id: string;
  title: string;
  status: CaseStatus;
  priority: CasePriority;
  created_at: string;
  category: { id: number; name: string; color: string | null } | null;
}

export function useCasesStats() {
  return useQuery<CasesStats>({
    queryKey: ['dashboard', 'cases-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cases')
        .select('status, priority, due_date');
      if (error) throw error;
      const stats: CasesStats = {
        nowa: 0, w_toku: 0, oczekuje: 0, załatwiona: 0, odrzucona: 0,
        urgent: 0, high: 0, due_soon: 0, total: 0,
      };
      const todayMs = new Date().setHours(0, 0, 0, 0);
      const DAY_MS = 24 * 60 * 60 * 1000;
      for (const row of data ?? []) {
        const s = row as { status: CaseStatus; priority: CasePriority; due_date: string | null };
        stats[s.status]++;
        stats.total++;
        if (s.priority === 'urgent') stats.urgent++;
        if (s.priority === 'high') stats.high++;
        if (
          s.due_date &&
          s.status !== 'załatwiona' &&
          s.status !== 'odrzucona'
        ) {
          const dueMs = new Date(s.due_date).setHours(0, 0, 0, 0);
          if (!Number.isNaN(dueMs)) {
            const diffDays = Math.round((dueMs - todayMs) / DAY_MS);
            if (diffDays >= 0 && diffDays <= 3) stats.due_soon++;
          }
        }
      }
      return stats;
    },
    staleTime: 30_000,
  });
}

export interface ContactsStats {
  total: number;
  /** Kontakty ze zgodą na newsletter. */
  newsletter: number;
  /** Kontakty dodane w ostatnich 30 dniach. */
  recent: number;
}

export function useContactsStats() {
  return useQuery<ContactsStats>({
    queryKey: ['dashboard', 'contacts-stats'],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const head = () => supabase.from('contacts').select('id', { count: 'exact', head: true });
      const [total, newsletter, recent] = await Promise.all([
        head(),
        head().eq('newsletter_consent', true),
        head().gte('created_at', since),
      ]);
      const error = total.error ?? newsletter.error ?? recent.error;
      if (error) throw error;
      return {
        total: total.count ?? 0,
        newsletter: newsletter.count ?? 0,
        recent: recent.count ?? 0,
      };
    },
    staleTime: 60_000,
  });
}

export function useUpcomingEvents(limit = 6) {
  const now = new Date().toISOString();
  return useQuery<UpcomingEvent[]>({
    queryKey: ['dashboard', 'upcoming-events', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, title, type, starts_at, ends_at, all_day, location')
        .gte('starts_at', now)
        .order('starts_at', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as UpcomingEvent[];
    },
    staleTime: 30_000,
  });
}

export function useRecentCases(limit = 5) {
  return useQuery<RecentCase[]>({
    queryKey: ['dashboard', 'recent-cases', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cases')
        .select('id, title, status, priority, created_at, category:case_categories(id, name, color)')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as RecentCase[];
    },
    staleTime: 30_000,
  });
}

export interface CasesAreaRow {
  powiat_id: number;
  name: string;
  count: number;
  /** Gmina z największą liczbą aktywnych spraw w tym powiecie (null, gdy żadna nie ma gminy). */
  top_gmina: { name: string; count: number } | null;
}

export interface CasesByArea {
  /** Powiaty malejąco po liczbie aktywnych spraw. */
  rows: CasesAreaRow[];
  /** Aktywne sprawy bez powiatu. */
  unassigned: number;
  total: number;
}

/** Aktywne sprawy (nowa / w toku / oczekuje) według powiatu, z najczęstszą gminą w każdym. */
export function useCasesByArea() {
  return useQuery<CasesByArea>({
    queryKey: ['dashboard', 'cases-by-area'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cases')
        .select('powiat:powiaty(id, name), gmina:gminy(id, name)')
        .in('status', ['nowa', 'w_toku', 'oczekuje']);
      if (error) throw error;
      type Row = { powiat: { id: number; name: string } | null; gmina: { id: number; name: string } | null };
      const byPowiat = new Map<number, { name: string; count: number; gminy: Map<string, number> }>();
      let unassigned = 0;
      const rows = (data ?? []) as unknown as Row[];
      for (const { powiat, gmina } of rows) {
        if (!powiat) {
          unassigned++;
          continue;
        }
        const entry = byPowiat.get(powiat.id) ?? { name: powiat.name, count: 0, gminy: new Map() };
        entry.count++;
        if (gmina) entry.gminy.set(gmina.name, (entry.gminy.get(gmina.name) ?? 0) + 1);
        byPowiat.set(powiat.id, entry);
      }
      return {
        rows: [...byPowiat]
          .map(([powiat_id, { name, count, gminy }]) => {
            let top_gmina: CasesAreaRow['top_gmina'] = null;
            for (const [gName, gCount] of gminy) {
              if (!top_gmina || gCount > top_gmina.count) top_gmina = { name: gName, count: gCount };
            }
            return { powiat_id, name, count, top_gmina };
          })
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl')),
        unassigned,
        total: rows.length,
      };
    },
    staleTime: 30_000,
  });
}

/** Zaangażowanie (0-100) względem najaktywniejszej osoby w biurze, ostatnie 30 dni. */
export function useMyEngagement() {
  return useQuery<number>({
    queryKey: ['dashboard', 'my-engagement'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_engagement');
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
    staleTime: 60_000,
  });
}

export interface DashboardInterpellation {
  id: string;
  subject: string;
  recipient: string;
  status: InterpellationStatus;
  revision: number;
  submitted_at: string;
  deadline_at: string | null;
  created_by: string | null;
}

export interface DashboardInterpellations {
  items: DashboardInterpellation[];
  counts: Record<InterpellationStatus, number>;
  overdue: number;
  total: number;
}

/** Aktywne interpelacje widoczne dla użytkownika zgodnie z RLS. */
export function useDashboardInterpellations() {
  useInterpellationsRealtime();
  return useQuery<DashboardInterpellations>({
    queryKey: ['dashboard', 'interpellations'],
    queryFn: async ({ signal }) => {
      const items: DashboardInterpellation[] = [];
      const pageSize = 500;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from('interpellations')
          .select('id, subject, recipient, status, revision, submitted_at, deadline_at, created_by')
          .not('status', 'in', '(wyslana,odrzucona)')
          .order('submitted_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + pageSize - 1)
          .abortSignal(signal);
        if (error) throw error;
        const page = (data ?? []) as DashboardInterpellation[];
        items.push(...page);
        if (page.length < pageSize) break;
      }

      const counts: Record<InterpellationStatus, number> = {
        nowa: 0,
        uwagi: 0,
        po_poprawkach: 0,
        zaakceptowana: 0,
        wyslana: 0,
        odrzucona: 0,
      };
      let overdue = 0;
      const now = Date.now();
      for (const item of items) {
        counts[item.status] += 1;
        if (
          item.status === 'zaakceptowana' &&
          item.deadline_at &&
          new Date(item.deadline_at).getTime() <= now
        ) {
          overdue += 1;
        }
      }
      return { items, counts, overdue, total: items.length };
    },
    staleTime: 30_000,
  });
}

import { format, isToday, isTomorrow } from 'date-fns';
import { pl } from 'date-fns/locale';
import { deadlineState, isAwaitingDecision, type DeadlineState } from '@/lib/interpellations';
import type { Interpellation } from '@/integrations/supabase/types';

type UrgencyFields = Pick<Interpellation, 'status' | 'submitted_at' | 'deadline_at'>;

/**
 * Ranga pilności: 0 zaakceptowana po terminie, 1 zaakceptowana w terminie,
 * 2 czeka na decyzję Posła, 3 uwagi (czeka na poprawki), 4 zakończona.
 */
function urgencyRank(it: UrgencyFields, now: Date): number {
  if (it.status === 'zaakceptowana') {
    return it.deadline_at && deadlineState(it.deadline_at, now) === 'overdue' ? 0 : 1;
  }
  if (isAwaitingDecision(it.status)) return 2;
  if (it.status === 'uwagi') return 3;
  return 4;
}

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY);

/**
 * Porównanie "najpilniejsze najpierw": zaakceptowane wg terminu wysłania, potem
 * czekające na decyzję i z uwagami od najdawniej wgranych; zakończone na końcu, od najnowszych.
 */
export function compareUrgency(a: UrgencyFields, b: UrgencyFields, now: Date = new Date()): number {
  const rank = urgencyRank(a, now) - urgencyRank(b, now);
  if (rank !== 0) return rank;
  if (a.status === 'zaakceptowana' && b.status === 'zaakceptowana') {
    return time(a.deadline_at) - time(b.deadline_at);
  }
  const submitted = time(a.submitted_at) - time(b.submitted_at);
  return urgencyRank(a, now) === 4 ? -submitted : submitted;
}

/** Kopia listy posortowana wg pilności (jedno `now` dla całego sortowania). */
export function sortByUrgency<T extends UrgencyFields>(items: readonly T[], now: Date = new Date()): T[] {
  return [...items].sort((a, b) => compareUrgency(a, b, now));
}

/** Kolor tekstu terminu wysłania. */
export const DEADLINE_TEXT: Record<DeadlineState, string> = {
  overdue: 'text-destructive',
  soon: 'text-amber-600 dark:text-amber-400',
  ok: 'text-muted-foreground',
};

function compactDuration(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} dni`;
}

/** Względny opis terminu: "termin: jutro 14:30" albo "po terminie 3 h". */
export function deadlineLabel(deadlineAt: string, now: Date = new Date()): string {
  const deadline = new Date(deadlineAt);
  const left = deadline.getTime() - now.getTime();
  if (left <= 0) return `po terminie ${compactDuration(-left)}`;
  const hour = format(deadline, 'HH:mm');
  if (isToday(deadline)) return `termin: dziś ${hour}`;
  if (isTomorrow(deadline)) return `termin: jutro ${hour}`;
  return `termin: ${format(deadline, 'd MMM', { locale: pl })} ${hour}`;
}

import { addDays, endOfWeek, isAfter, isBefore, isSameDay, isToday, isTomorrow, startOfDay, startOfWeek } from 'date-fns';
import type { EventType } from '@/integrations/supabase/types';

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  spotkanie: 'Spotkanie',
  wyjazd: 'Wyjazd',
  media: 'Media',
  inne: 'Inne',
};

export const EVENT_TYPES: EventType[] = ['spotkanie', 'wyjazd', 'media', 'inne'];

export const EVENT_TYPE_DOT: Record<EventType, string> = {
  spotkanie: 'bg-blue-500',
  wyjazd: 'bg-emerald-500',
  media: 'bg-purple-500',
  inne: 'bg-slate-500',
};

/** Miękka "pigułka" typu (tło + tekst) - badge w listach i chipy w siatce miesiąca. */
export const EVENT_TYPE_PILL: Record<EventType, string> = {
  spotkanie: 'bg-blue-500/10 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
  wyjazd: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
  media: 'bg-purple-500/10 text-purple-700 dark:bg-purple-400/15 dark:text-purple-300',
  inne: 'bg-slate-500/10 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300',
};

export type EventGroupKey =
  | 'past'
  | 'today'
  | 'tomorrow'
  | 'this_week'
  | 'next_week'
  | 'later';

export const EVENT_GROUP_LABELS: Record<EventGroupKey, string> = {
  past: 'Minione',
  today: 'Dzisiaj',
  tomorrow: 'Jutro',
  this_week: 'W tym tygodniu',
  next_week: 'W przyszłym tygodniu',
  later: 'Później',
};

export function classifyEventDate(starts_at: string, now: Date = new Date()): EventGroupKey {
  const date = new Date(starts_at);
  if (isBefore(date, startOfDay(now))) return 'past';
  if (isToday(date)) return 'today';
  if (isTomorrow(date)) return 'tomorrow';
  // weekStartsOn = 1 (poniedzialek)
  const thisWeekEnd = endOfWeek(now, { weekStartsOn: 1 });
  if (!isAfter(date, thisWeekEnd)) return 'this_week';
  const nextWeekStart = startOfWeek(addDays(thisWeekEnd, 1), { weekStartsOn: 1 });
  const nextWeekEnd = endOfWeek(nextWeekStart, { weekStartsOn: 1 });
  if (!isAfter(date, nextWeekEnd)) return 'next_week';
  return 'later';
}

export function eventOnDay(starts_at: string, ends_at: string | null, day: Date): boolean {
  const start = new Date(starts_at);
  const end = ends_at ? new Date(ends_at) : start;
  if (isSameDay(start, day)) return true;
  // event w trakcie (multi-day)
  return isBefore(start, day) && isAfter(end, day);
}

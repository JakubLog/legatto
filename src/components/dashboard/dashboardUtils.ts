import { format, isThisWeek, isToday, isTomorrow } from 'date-fns';
import { pl } from 'date-fns/locale';

export function formatEventDate(starts_at: string): string {
  const date = new Date(starts_at);
  if (isToday(date)) return `Dzisiaj, ${format(date, 'HH:mm')}`;
  if (isTomorrow(date)) return `Jutro, ${format(date, 'HH:mm')}`;
  if (isThisWeek(date, { weekStartsOn: 1 }))
    return format(date, 'EEEE, HH:mm', { locale: pl });
  return format(date, 'd MMM, HH:mm', { locale: pl });
}

export function formatEventDateAllDay(starts_at: string): string {
  const date = new Date(starts_at);
  if (isToday(date)) return 'Dzisiaj';
  if (isTomorrow(date)) return 'Jutro';
  if (isThisWeek(date, { weekStartsOn: 1 }))
    return format(date, 'EEEE', { locale: pl });
  return format(date, 'd MMM', { locale: pl });
}

/** Polska fleksja: "1 sprawa jest", "2-4 sprawy są", "5+ spraw jest". */
export function pluralCases(n: number): string {
  if (n === 1) return 'sprawa jest';
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'sprawy są';
  return 'spraw jest';
}

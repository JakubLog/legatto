import { format, isSameDay } from 'date-fns';
import { pl } from 'date-fns/locale';
import type { PublicCalendarEvent } from '@/integrations/supabase/types';

/** Polska fleksja liczebnika: 1 osoba, 2-4 osoby, 5+ osób (12-14 jak 5+). */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const h = n % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}

/** Klucz dnia `yyyy-MM-dd` w czasie lokalnym - wspólny dla wydarzeń biura i posiedzeń Sejmu. */
export const dayKey = (date: Date) => format(date, 'yyyy-MM-dd');

export function formatTimeRange(event: PublicCalendarEvent): string {
  if (event.all_day) return 'Cały dzień';
  const start = new Date(event.starts_at);
  const startStr = format(start, 'HH:mm', { locale: pl });
  if (!event.ends_at) return startStr;
  const end = new Date(event.ends_at);
  if (!isSameDay(start, end)) {
    return `${startStr} - ${format(end, 'd MMM HH:mm', { locale: pl })}`;
  }
  return `${startStr} - ${format(end, 'HH:mm', { locale: pl })}`;
}

export function locationLabel(event: PublicCalendarEvent): string | null {
  const parts = [event.location, event.gmina_name, event.powiat_name].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  // Unikamy duplikatu jeśli np. location === gmina
  return Array.from(new Set(parts)).join(' - ');
}

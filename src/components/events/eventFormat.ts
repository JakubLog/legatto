import { format, isSameDay } from 'date-fns';
import { pl } from 'date-fns/locale';

/** "1 wydarzenie", "3 wydarzenia", "5 wydarzeń". */
export function pluralizeEvents(count: number): string {
  if (count === 1) return '1 wydarzenie';
  const mod10 = count % 10;
  const mod100 = count % 100;
  const few = mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14);
  return `${count} ${few ? 'wydarzenia' : 'wydarzeń'}`;
}

/** Godziny wydarzenia widziane z perspektywy dnia `day` (domyślnie dzień startu). */
export function formatEventTime(
  starts_at: string,
  ends_at: string | null,
  all_day: boolean,
  day?: Date,
): string {
  if (all_day) return 'Cały dzień';
  const start = new Date(starts_at);
  if (day && !isSameDay(start, day)) return `od ${format(start, 'd MMM HH:mm', { locale: pl })}`;
  const startStr = format(start, 'HH:mm', { locale: pl });
  if (!ends_at) return startStr;
  return `${startStr} – ${format(new Date(ends_at), 'HH:mm', { locale: pl })}`;
}

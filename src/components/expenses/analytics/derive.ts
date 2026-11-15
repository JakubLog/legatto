import { format, parseISO } from 'date-fns';
import { pl } from 'date-fns/locale';
import type { BudgetAnalytics, BudgetMonthTotal } from '@/integrations/supabase/types';

/** Data wydatku 'YYYY-MM-DD' jako "3 paź" (czas lokalny, bez przesunięcia strefy). */
export function formatShortDate(isoDate: string): string {
  return format(parseISO(isoDate), 'd MMM', { locale: pl });
}

/** Zmiana kwoty względem punktu odniesienia; `pct` = null gdy odniesienie 0 (procent bez sensu). */
export interface AmountDelta {
  diff: number;
  pct: number | null;
}

export function amountDelta(current: number, reference: number): AmountDelta {
  const diff = round2(current - reference);
  return { diff, pct: reference > 0 ? (diff / reference) * 100 : null };
}

/** Miesiąc z analityki jest bieżący (otwarty) wg daty bazy (Europe/Warsaw). */
export function isOpenMonth(a: Pick<BudgetAnalytics, 'month' | 'as_of'>): boolean {
  return a.as_of.slice(0, 7) === a.month;
}

/** Suma wybranego miesiąca = ostatni element `months`. */
export function monthTotal(a: Pick<BudgetAnalytics, 'months'>): number {
  return a.months[a.months.length - 1]?.total ?? 0;
}

/** Średnia 3 miesięcy przed wybranym (puste miesiące = 0); null gdy historia krótsza niż 3 miesiące. */
export function previousAvg3(months: BudgetMonthTotal[]): number | null {
  const prev = months.slice(0, -1).slice(-3);
  if (prev.length < 3) return null;
  return round2(prev.reduce((sum, m) => sum + m.total, 0) / 3);
}

/**
 * Prognoza na koniec miesiąca: tempo liniowe z wydatków do dzisiaj (do dziś / dni minione * dni
 * miesiąca), nie mniej niż suma już wpisanych (w tym z datą przyszłą, np. zaplanowane wynagrodzenia).
 * Tylko dla bieżącego miesiąca; dla zamkniętego null (wynik jest znany).
 */
export function monthForecast(
  a: Pick<BudgetAnalytics, 'months' | 'pace' | 'month' | 'as_of' | 'current_to_date'>,
): number | null {
  if (!isOpenMonth(a)) return null;
  const { days_elapsed, days_in_month } = a.pace;
  if (days_elapsed <= 0) return null;
  return round2(Math.max(monthTotal(a), (a.current_to_date / days_elapsed) * days_in_month));
}

/** Udział w procentach (0 gdy całość 0). */
export function sharePercent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** Procent z jednym miejscem po przecinku i znakiem, np. "+12,3%". */
export function formatSignedPercent(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

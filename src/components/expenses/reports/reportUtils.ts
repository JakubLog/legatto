import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import type { BudgetAnalytics, BudgetReportWithCreator } from '@/integrations/supabase/types';

/** Data i godzina wygenerowania raportu, np. "26 października 2026, 14:05". */
export function formatReportDate(iso: string, pattern = "d MMMM yyyy', 'HH:mm"): string {
  return format(new Date(iso), pattern, { locale: pl });
}

export function reportAuthor(report: BudgetReportWithCreator): string {
  return report.creator?.full_name ?? (report.created_by ? 'Nieznany użytkownik' : 'Konto usunięte');
}

/** Zmiana procentowa `current` względem `previous`; `null`, gdy nie ma bazy do porównania. */
export function percentChange(current: number, previous: number): number | null {
  if (!(previous > 0)) return null;
  return ((current - previous) / previous) * 100;
}

export function formatPercentChange(pct: number | null): string {
  if (pct === null) return '-';
  const rounded = Math.round(pct);
  if (rounded === 0) return '0%';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`;
}

/** Tytuły wydatków znane z migawki analityki (sygnały: nietypowe, opłaty, duplikaty). */
export function expenseTitlesFromAnalytics(analytics: BudgetAnalytics | null | undefined): Map<string, string> {
  const titles = new Map<string, string>();
  if (!analytics) return titles;
  for (const a of analytics.anomalies ?? []) titles.set(a.id, a.title);
  for (const f of analytics.fees ?? []) titles.set(f.id, f.title);
  for (const d of analytics.duplicates ?? []) {
    for (const id of d.ids) if (!titles.has(id)) titles.set(id, d.title);
  }
  return titles;
}

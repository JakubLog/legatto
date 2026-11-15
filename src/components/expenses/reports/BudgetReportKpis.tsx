import { CalendarClock, CalendarRange, Wallet } from 'lucide-react';
import { BudgetKpiCard } from '@/components/expenses/BudgetKpiCard';
import type { BudgetAnalytics } from '@/integrations/supabase/types';
import { useMonthlyBudgetLimit } from '@/hooks/useBudgetSettings';
import { budgetUsagePercent, formatMonthLabel, formatPLN } from '@/lib/expenses';
import { formatPercentChange, percentChange } from './reportUtils';

/** Kluczowe liczby z migawki analityki - raport czytelny bez przechodzenia do widoku Analityka. */
export function BudgetReportKpis({ analytics }: { analytics: BudgetAnalytics }) {
  const { limit: currentLimit } = useMonthlyBudgetLimit();
  // Limit z chwili generowania raportu (migawka od 2026-11); starsze raporty - bieżący limit.
  const limit = analytics.monthly_limit_pln ?? currentLimit;
  const monthTotal = analytics.months[analytics.months.length - 1]?.total ?? 0;
  const { days_elapsed, days_in_month } = analytics.pace;
  const partialMonth = days_elapsed < days_in_month;
  const vsPrevious = percentChange(analytics.current_to_date, analytics.previous_to_date);
  const vsPrevYear = percentChange(analytics.ytd.total, analytics.ytd.prev_year_same_period);

  return (
    <div className="grid gap-3 @sm:grid-cols-3">
      <BudgetKpiCard
        label={`Wydatki - ${formatMonthLabel(analytics.month)}`}
        icon={Wallet}
        value={formatPLN(monthTotal)}
        hint={`${Math.round(budgetUsagePercent(monthTotal, limit))}% limitu ${formatPLN(limit)}${
          partialMonth ? ` · stan na ${days_elapsed}. dzień` : ''
        }`}
      />
      <BudgetKpiCard
        label="Względem poprzedniego miesiąca"
        icon={CalendarClock}
        value={formatPercentChange(vsPrevious)}
        hint={
          partialMonth
            ? `Do ${days_elapsed}. dnia: ${formatPLN(analytics.current_to_date)} vs ${formatPLN(analytics.previous_to_date)}`
            : `Cały poprzedni miesiąc: ${formatPLN(analytics.previous_to_date)}`
        }
      />
      <BudgetKpiCard
        label={`Rok ${analytics.ytd.year} narastająco`}
        icon={CalendarRange}
        value={formatPLN(analytics.ytd.total)}
        hint={`Rok wcześniej: ${formatPLN(analytics.ytd.prev_year_same_period)}${
          vsPrevYear === null ? '' : ` (${formatPercentChange(vsPrevYear)})`
        }`}
      />
    </div>
  );
}

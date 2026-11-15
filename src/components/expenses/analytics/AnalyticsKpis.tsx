import { getDaysInMonth } from 'date-fns';
import { CalendarRange, Gauge, History, Wallet } from 'lucide-react';
import { BudgetKpiCard } from '@/components/expenses/BudgetKpiCard';
import {
  BUDGET_LEVEL_CLASSES,
  budgetLevel,
  budgetUsagePercent,
  formatMonthLabel,
  formatPercent1,
  formatPLN,
  parseYearMonth,
  shiftMonth,
} from '@/lib/expenses';
import type { BudgetAnalytics } from '@/integrations/supabase/types';
import { DeltaBadge } from './AnalyticsUi';
import { amountDelta, isOpenMonth, monthForecast, monthTotal, previousAvg3 } from './derive';

const GRID = 'grid gap-3 @sm:grid-cols-2 @lg:grid-cols-4';

/** Kafelki KPI analityki: miesiąc vs poprzedni, vs średnia 3 mies., prognoza/limit, rok-do-daty. `limit` = limit miesięczny w zł. */
export function AnalyticsKpis({ data, limit }: { data: BudgetAnalytics; limit: number }) {
  const total = monthTotal(data);
  const open = isOpenMonth(data);
  const prevMonth = shiftMonth(data.month, -1);
  const prevDays = Math.min(data.pace.days_elapsed, getDaysInMonth(parseYearMonth(prevMonth)));
  const avg3 = previousAvg3(data.months);
  const forecast = monthForecast(data);
  // Wynik pełnego miesiąca: dla bieżącego prognoza (porównywalna ze średnią i limitem), dla zamkniętego suma.
  const projected = forecast ?? total;
  const level = budgetLevel(projected, limit);
  const levelClasses = BUDGET_LEVEL_CLASSES[level];
  const prevYear = String(Number(data.ytd.year) - 1);

  return (
    <section aria-label="Wskaźniki miesiąca" className={GRID}>
      <BudgetKpiCard
        label={<span className="capitalize">Wydano · {formatMonthLabel(data.month)}</span>}
        icon={Wallet}
        value={formatPLN(total)}
        hint={
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <DeltaBadge delta={amountDelta(data.current_to_date, data.previous_to_date)} />
            <span className="tabular-nums">
              {open
                ? `${formatPLN(data.current_to_date)} do dziś vs ${formatPLN(data.previous_to_date)} · ${formatMonthLabel(prevMonth)} do ${prevDays}. dnia`
                : `vs ${formatPLN(data.previous_to_date)} · cały ${formatMonthLabel(prevMonth)}`}
            </span>
          </span>
        }
      />

      <BudgetKpiCard
        label="Średnia 3 poprzednich miesięcy"
        icon={History}
        value={avg3 === null ? '-' : formatPLN(avg3)}
        hint={
          avg3 === null ? (
            'Za krótka historia'
          ) : (
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <DeltaBadge delta={amountDelta(projected, avg3)} />
              <span>{open ? 'prognoza miesiąca vs średnia' : 'ten miesiąc vs średnia'}</span>
            </span>
          )
        }
      />

      <BudgetKpiCard
        label={open ? 'Prognoza na koniec miesiąca' : 'Wykorzystanie limitu'}
        icon={Gauge}
        iconClassName={levelClasses.soft}
        valueClassName={levelClasses.text}
        value={open ? formatPLN(projected) : formatPercent1(budgetUsagePercent(total, limit))}
        hint={
          <span className="tabular-nums">
            {open
              ? `${budgetUsagePercent(projected, limit).toFixed(0)}% limitu · dzień ${data.pace.days_elapsed} z ${data.pace.days_in_month}`
              : level === 'over'
                ? `Limit przekroczony o ${formatPLN(total - limit)}`
                : `${formatPLN(total)} z ${formatPLN(limit)}`}
          </span>
        }
      />

      <BudgetKpiCard
        label={`Rok ${data.ytd.year} narastająco`}
        icon={CalendarRange}
        value={formatPLN(data.ytd.total)}
        hint={
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <DeltaBadge delta={amountDelta(data.ytd.total, data.ytd.prev_year_same_period)} />
            <span className="tabular-nums">
              vs {formatPLN(data.ytd.prev_year_same_period)} w {prevYear}
            </span>
          </span>
        }
      />
    </section>
  );
}

/** Szkielet kafelków KPI na czas pierwszego ładowania. */
export function AnalyticsKpisSkeleton() {
  return (
    <div className={GRID} aria-hidden>
      {[Wallet, History, Gauge, CalendarRange].map((icon, i) => (
        <BudgetKpiCard key={i} label=" " icon={icon} value="" isLoading />
      ))}
    </div>
  );
}

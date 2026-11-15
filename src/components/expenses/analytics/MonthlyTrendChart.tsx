import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { ChartColumn } from 'lucide-react';
import {
  budgetLevel,
  budgetUsagePercent,
  formatMonthLabel,
  formatPLN,
  parseYearMonth,
  type BudgetLevel,
} from '@/lib/expenses';
import { cn } from '@/lib/utils';
import type { BudgetMonthTotal } from '@/integrations/supabase/types';
import { AnalyticsCard } from './AnalyticsUi';

/** Wypełnienie słupka wg poziomu koszyka (pełne literały klas dla Tailwind JIT). */
const LEVEL_FILL: Record<BudgetLevel, string> = {
  ok: 'fill-emerald-500',
  warning: 'fill-amber-500',
  critical: 'fill-orange-500',
  over: 'fill-destructive',
};

/** Szerokość kolumny miesiąca w jednostkach viewBox (wysokość obszaru = 100). */
const COL = 10;
const BAR = 6;

interface Props {
  months: BudgetMonthTotal[];
  selected: string;
  onSelect: (month: string) => void;
  /** Miesięczny limit w zł (jeden dla wszystkich miesięcy - bieżące ustawienie). */
  limit: number;
}

/** Słupki 12 miesięcy z linią limitu; klik w słupek wybiera miesiąc. */
export function MonthlyTrendChart({ months, selected, onSelect, limit }: Props) {
  const scaleMax = Math.max(limit * 1.15, ...months.map((m) => m.total * 1.08));
  const heightOf = (value: number) => (value / scaleMax) * 100;
  const limitTop = 100 - heightOf(limit);
  const width = months.length * COL;

  return (
    <AnalyticsCard
      title="Ostatnie 12 miesięcy"
      icon={ChartColumn}
      description="Kliknij słupek, aby przejść do miesiąca. Linia przerywana to limit koszyka."
    >
      <div role="group" aria-label="Wydatki w ostatnich 12 miesiącach">
        <div className="relative h-44 @lg:h-56">
          <svg
            viewBox={`0 0 ${width} 100`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            aria-hidden
          >
            <line x1={0} x2={width} y1={100} y2={100} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {months.map((m, i) => {
              const h = heightOf(m.total);
              const isSelected = m.month === selected;
              return (
                <rect
                  key={m.month}
                  x={i * COL + (COL - BAR) / 2}
                  width={BAR}
                  // Pusty miesiąc: cienka kreska, żeby było widać, że jest w historii.
                  y={100 - Math.max(h, 0.8)}
                  height={Math.max(h, 0.8)}
                  className={cn(
                    m.total > 0 ? LEVEL_FILL[budgetLevel(m.total, limit)] : 'fill-muted-foreground/30',
                    !isSelected && 'opacity-45',
                  )}
                />
              );
            })}
            <line
              x1={0}
              x2={width}
              y1={limitTop}
              y2={limitTop}
              className="stroke-muted-foreground"
              strokeWidth={1}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <span
            className="pointer-events-none absolute right-0 -translate-y-full pb-0.5 text-[10px] font-medium text-muted-foreground tabular-nums"
            style={{ top: `${limitTop}%` }}
            aria-hidden
          >
            Limit {formatPLN(limit)}
          </span>

          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
            {months.map((m) => {
              const isSelected = m.month === selected;
              const label = `${formatMonthLabel(m.month)}: ${formatPLN(m.total)} (${budgetUsagePercent(m.total, limit).toFixed(0)}% limitu, wydatków: ${m.count})`;
              return (
                <button
                  key={m.month}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-current={isSelected ? 'date' : undefined}
                  onClick={() => onSelect(m.month)}
                  className={cn(
                    'rounded-md transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected && 'bg-primary/5',
                  )}
                />
              );
            })}
          </div>
        </div>

        <div
          className="mt-1.5 grid text-center text-[10px] leading-tight text-muted-foreground"
          style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}
          aria-hidden
        >
          {months.map((m, i) => {
            const date = parseYearMonth(m.month);
            const showYear = i === 0 || date.getMonth() === 0;
            return (
              <span key={m.month} className={cn('truncate', m.month === selected && 'font-semibold text-foreground')}>
                {format(date, 'LLL', { locale: pl })}
                {showYear && <span className="block">{format(date, 'yyyy')}</span>}
              </span>
            );
          })}
        </div>
      </div>
    </AnalyticsCard>
  );
}

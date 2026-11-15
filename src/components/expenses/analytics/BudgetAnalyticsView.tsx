import { ShieldAlert } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorNotice } from '@/components/admin/AdminUi';
import { useBudgetAnalytics } from '@/hooks/useBudgetAnalytics';
import { useMonthlyBudgetLimit } from '@/hooks/useBudgetSettings';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { AnalyticsKpis, AnalyticsKpisSkeleton } from './AnalyticsKpis';
import { CategoryBreakdown } from './CategoryBreakdown';
import { MonthlyTrendChart } from './MonthlyTrendChart';
import { Anomalies, Fees, PossibleDuplicates, RecurringCosts } from './SignalLists';
import { DataQuality, PaymentMethods, SmallExpenses } from './SignalSummaries';
import { TopVendors } from './TopVendors';
import { monthTotal } from './derive';

/** Dwie kolumny dopiero gdy moduł jest szeroki (nie w połowie ekranu obok PoliAI). */
const TWO_COLUMNS = 'grid items-start gap-4 @3xl:grid-cols-2';

interface Props {
  month: string;
  onMonthChange: (month: string) => void;
}

/** Widok "Analityka" budżetu: KPI, 12 miesięcy, kategorie, kontrahenci, sygnały ukrytych kosztów. */
export function BudgetAnalyticsView({ month, onMonthChange }: Props) {
  const { data, isLoading, isError, error, isPlaceholderData } = useBudgetAnalytics(month);
  const { limit, isLoading: limitLoading } = useMonthlyBudgetLimit();

  if (isError) {
    return <ErrorNotice title="Nie udało się policzyć analityki budżetu" message={errorMessage(error)} />;
  }

  if (isLoading || limitLoading || !data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only">Ładowanie analityki budżetu</span>
        <AnalyticsKpisSkeleton />
        <Skeleton className="h-72 w-full rounded-xl" />
        <div className={TWO_COLUMNS}>
          <Skeleton className="h-80 w-full rounded-xl" />
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  const total = monthTotal(data);

  return (
    <div
      className={cn('space-y-4 transition-opacity', isPlaceholderData && 'opacity-60')}
      aria-busy={isPlaceholderData}
    >
      <AnalyticsKpis data={data} limit={limit} />
      <MonthlyTrendChart months={data.months} selected={data.month} onSelect={onMonthChange} limit={limit} />

      <div className={TWO_COLUMNS}>
        <CategoryBreakdown categories={data.categories} monthTotal={total} />
        <TopVendors vendors={data.vendors} />
      </div>

      <section aria-labelledby="budget-signals-heading" className="space-y-3">
        <div className="flex items-start gap-2 pt-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div>
            <h2 id="budget-signals-heading" className="text-base font-semibold">
              Sygnały i ukryte koszty
            </h2>
            <p className="text-xs text-muted-foreground">
              Koszty stałe, podwójne wpisy, nietypowe kwoty, opłaty dodatkowe i braki w dokumentacji.
            </p>
          </div>
        </div>
        <div className={TWO_COLUMNS}>
          <RecurringCosts items={data.recurring} />
          <PossibleDuplicates items={data.duplicates} />
          <Anomalies items={data.anomalies} />
          <Fees items={data.fees} />
          <SmallExpenses small={data.small_expenses} monthTotal={total} />
          <DataQuality quality={data.data_quality} />
          <PaymentMethods methods={data.payment_methods} monthTotal={total} />
        </div>
      </section>
    </div>
  );
}

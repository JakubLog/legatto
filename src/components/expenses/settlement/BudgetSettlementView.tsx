import { useMemo, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { AlertTriangle, CalendarRange, FileDown, FileWarning, PiggyBank, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorNotice } from '@/components/admin/AdminUi';
import { BudgetKpiCard } from '@/components/expenses/BudgetKpiCard';
import { useBudgetYearSummary } from '@/hooks/useBudgetSettlement';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import { useMonthlyBudgetLimit } from '@/hooks/useBudgetSettings';
import { errorMessage } from '@/lib/errors';
import { formatPLN } from '@/lib/expenses';
import { addAmounts, buildSettlement, settlementMonths } from '@/lib/settlement';
import { useMpForms } from '@/hooks/useMpForms';
import { cn } from '@/lib/utils';
import { SettlementCategoryTable } from './SettlementCategoryTable';
import { SettlementPreview } from './SettlementPreview';
import { SettlementReportDialog } from './SettlementReportDialog';

interface Props {
  year: number;
  /** Poseł/Administrator: przypisywanie pozycji sprawozdania do kategorii. */
  canEditMapping: boolean;
  renderHeader: (actions?: ReactNode) => ReactNode;
}

const periodDate = (iso: string) => format(new Date(`${iso}T12:00:00`), 'd MMMM yyyy', { locale: pl });

/** Widok "Podsumowanie i rozliczenie": rok w kategoriach, pozycje sprawozdania, generowanie DOCX. */
export function BudgetSettlementView({ year, canEditMapping, renderHeader }: Props) {
  const summaryQuery = useBudgetYearSummary(year);
  const categoriesQuery = useExpenseCategories();
  const budget = useMonthlyBudgetLimit();
  const [reportOpen, setReportOpen] = useState(false);
  const mp = useMpForms();

  const summary = summaryQuery.data;
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const settlement = useMemo(
    () => (summary ? buildSettlement(categories, summary.categories) : null),
    [categories, summary],
  );

  const loading = summaryQuery.isLoading || categoriesQuery.isLoading || budget.isLoading;
  const error = summaryQuery.error ?? categoriesQuery.error;
  const months = summary ? settlementMonths(summary.date_to) : 0;
  const allowance = budget.limit * months;
  const blocked = !settlement || settlement.unassigned.length > 0;

  const header = renderHeader(
    // Telefon: pełna szerokość jak akcje widoku Wydatki.
    <Button className="w-full @sm:w-auto" onClick={() => setReportOpen(true)} disabled={loading || blocked}>
      <FileDown />
      Generuj sprawozdanie
    </Button>,
  );

  if (error) {
    return (
      <>
        {header}
        <ErrorNotice title="Nie udało się policzyć podsumowania roku" message={errorMessage(error)} />
      </>
    );
  }

  if (loading || !summary || !settlement) {
    return (
      <>
        {header}
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only">Ładowanie podsumowania roku</span>
          <div className="grid gap-3 @sm:grid-cols-2 @lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </>
    );
  }

  const remaining = addAmounts(allowance, -summary.total);

  return (
    <>
      {header}
      <div
        className={cn('space-y-4 transition-opacity', summaryQuery.isPlaceholderData && 'opacity-60')}
        aria-busy={summaryQuery.isPlaceholderData}
      >
        <div className="grid gap-3 @sm:grid-cols-2 @lg:grid-cols-4">
          <BudgetKpiCard
            label={`Wydatki ${summary.year}`}
            icon={Wallet}
            value={formatPLN(summary.total)}
            hint={`${periodDate(summary.date_from)} - ${periodDate(summary.date_to)} · ${summary.count} dok.`}
          />
          <BudgetKpiCard
            label="Ryczałt w okresie"
            icon={CalendarRange}
            value={formatPLN(allowance)}
            hint={
              budget.isError
                ? `Nie udało się odczytać limitu - przyjęto domyślne ${formatPLN(budget.limit)} / mies.`
                : `${months} mies. × ${formatPLN(budget.limit)} (limit miesięczny)`
            }
          />
          <BudgetKpiCard
            label="Pozostało z ryczałtu"
            icon={PiggyBank}
            value={formatPLN(remaining)}
            valueClassName={remaining < 0 ? 'text-destructive' : undefined}
            iconClassName={remaining < 0 ? 'bg-destructive/10 text-destructive' : undefined}
            hint={remaining < 0 ? 'Wydatki przekraczają ryczałt w okresie' : 'Ryczałt w okresie minus wydatki'}
          />
          <BudgetKpiCard
            label="Dokumenty bez faktury"
            icon={FileWarning}
            value={summary.missing_invoice_count}
            valueClassName={summary.missing_invoice_count > 0 ? 'text-amber-700 dark:text-amber-300' : undefined}
            iconClassName={
              summary.missing_invoice_count > 0 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : undefined
            }
            hint={
              summary.missing_invoice_count > 0
                ? `Wydatki bez pliku faktury/paragonu na ${formatPLN(summary.missing_invoice_total)}`
                : 'Każdy wydatek ma dołączony dokument'
            }
          />
        </div>

        {settlement.unassigned.length > 0 && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              Wydatki na {formatPLN(settlement.unassignedTotal)} nie mają pozycji sprawozdania:{' '}
              {settlement.unassigned.map((u) => `${u.name} (${formatPLN(u.total)})`).join(', ')}.{' '}
              Sprawozdanie będzie można wygenerować po{' '}
              {[
                settlement.unassigned.some((u) => u.categoryId !== null) &&
                  `przypisaniu pozycji kategoriom${canEditMapping ? ' w tabeli poniżej' : ` (robi to ${mp.nominative} lub Administrator)`}`,
                settlement.unassigned.some((u) => u.categoryId === null) &&
                  'nadaniu kategorii wydatkom bez kategorii (widok Wydatki)',
              ]
                .filter(Boolean)
                .join(' i ')}
              .
            </p>
          </div>
        )}

        <div className="grid items-start gap-4 @xl:grid-cols-2">
          <SettlementCategoryTable
            categories={categories}
            totals={summary.categories}
            yearTotal={summary.total}
            canEdit={canEditMapping}
          />
          <SettlementPreview settlement={settlement} />
        </div>
      </div>

      <SettlementReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        summary={summary}
        settlement={settlement}
        defaultFundsTransferred={allowance}
      />
    </>
  );
}

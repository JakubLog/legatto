import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarRange, Info, Plus, Target, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Page, PageHeader } from '@/components/layout/Page';
import { ModuleOwners } from '@/components/common/ModuleOwners';
import { useAuth } from '@/contexts/AuthContext';
import { useOpenParam } from '@/hooks/useOpenParam';
import { useMonthlyBudgetLimit, type MonthlyBudgetLimit } from '@/hooks/useBudgetSettings';
import { canWrite, isAdmin } from '@/lib/permissions';
import { currentMonthIso, currentYearIso, formatPLN, monthRangeIso } from '@/lib/expenses';
import { BudgetKpiCard } from '@/components/expenses/BudgetKpiCard';
import { BudgetLimitDialog } from '@/components/expenses/BudgetLimitDialog';
import { BudgetProgressCard } from '@/components/expenses/BudgetProgressCard';
import { BudgetViewTabs, type BudgetView } from '@/components/expenses/BudgetViewTabs';
import { MonthSelector } from '@/components/expenses/MonthSelector';
import { ExpensesFilters } from '@/components/expenses/ExpensesFilters';
import { ExpensesList } from '@/components/expenses/ExpensesList';
import { ExpenseFormDialog } from '@/components/expenses/ExpenseFormDialog';
import { ExpenseDetailsDialog } from '@/components/expenses/ExpenseDetailsDialog';
import { DeleteExpenseDialog } from '@/components/expenses/DeleteExpenseDialog';
import { BudgetAnalyticsView } from '@/components/expenses/analytics/BudgetAnalyticsView';
import { BudgetReportsView } from '@/components/expenses/reports/BudgetReportsView';
import { BudgetSettlementView } from '@/components/expenses/settlement/BudgetSettlementView';
import { YearSelector } from '@/components/expenses/settlement/YearSelector';
import { useExpense, useExpenses, type ExpensesFilters as Filters } from '@/hooks/useExpenses';
import type { OfficeExpenseWithRelations } from '@/integrations/supabase/types';

// Lokalny rok: `new Date(rok, 0, 1).toISOString()` w strefie +01:00 dawało 31 grudnia poprzedniego roku.
const startOfYearIso = () => `${currentYearIso()}-01-01`;

const sumExpenses = (rows: { amount: number | string }[]) =>
  rows.reduce((acc, r) => acc + Number(r.amount), 0);

const EMPTY_FILTERS: Filters = {
  categoryId: null,
  dateFrom: null,
  dateTo: null,
  search: '',
};

const VIEW_DESCRIPTIONS: Record<Exclude<BudgetView, 'wydatki'>, string> = {
  analityka: 'Porównania z poprzednimi miesiącami, struktura kosztów i sygnały ukrytych kosztów.',
  raporty: 'Raporty AI: wnioski, ukryte koszty, porównania, rekomendacje i prognoza.',
  rozliczenie: 'Rok od 1 stycznia w kategoriach i pozycjach sprawozdania z wydatkowania ryczałtu.',
};

/** Renderuje nagłówek strony z akcjami danego widoku. */
type HeaderRenderer = (actions?: ReactNode) => ReactNode;

export default function Budzet() {
  const { profile } = useAuth();
  const writer = canWrite(profile?.role);
  // Limit i pozycje sprawozdania kategorii edytuje Poseł/Administrator (RLS app_settings_update_posel,
  // RPC set_expense_category_settlement_item).
  const canEditLimit = isAdmin(profile?.role);
  const budget = useMonthlyBudgetLimit();
  const [searchParams, setSearchParams] = useSearchParams();
  const widokParam = searchParams.get('widok');
  // Deep-link `?open=<id>` dotyczy listy wydatków - zawsze pokazuje widok Wydatki.
  const widok: BudgetView = searchParams.get('open')
    ? 'wydatki'
    : widokParam === 'analityka' || widokParam === 'raporty' || widokParam === 'rozliczenie'
      ? widokParam
      : 'wydatki';
  // Miesiąc wspólny dla widoków miesięcznych; rozliczenie ma własny wybór roku.
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthIso());
  const currentYear = Number(currentYearIso());
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const setWidok = (next: BudgetView) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === 'wydatki') params.delete('widok');
        else params.set('widok', next);
        // Deep-link do wydatku dotyczy tylko listy - nie przenosimy go między widokami.
        params.delete('open');
        return params;
      },
      { replace: true },
    );
  };

  const renderHeader: HeaderRenderer = (actions) => (
    <PageHeader
      icon={Wallet}
      title="Budżet biura"
      titleAddon={<ModuleOwners module="budzet" />}
      description={
        widok === 'wydatki' ? `Koszyk miesięczny - limit ${formatPLN(budget.limit)} / miesiąc.` : VIEW_DESCRIPTIONS[widok]
      }
      actions={actions}
      toolbar={
        <>
          <BudgetViewTabs value={widok} onChange={setWidok} />
          {/* Wąski moduł: wybór miesiąca/roku w osobnym, pełnym wierszu pod zakładkami. */}
          <div className="ml-auto @max-md:ml-0 @max-md:w-full">
            {widok === 'rozliczenie' ? (
              <YearSelector value={selectedYear} onChange={setSelectedYear} max={currentYear} />
            ) : (
              <MonthSelector value={selectedMonth} onChange={setSelectedMonth} />
            )}
          </div>
        </>
      }
    />
  );

  return (
    <Page>
      {widok === 'wydatki' ? (
        <WydatkiView
          writer={writer}
          canEditLimit={canEditLimit}
          budget={budget}
          month={selectedMonth}
          onMonthChange={setSelectedMonth}
          renderHeader={renderHeader}
        />
      ) : widok === 'rozliczenie' ? (
        <BudgetSettlementView year={selectedYear} canEditMapping={canEditLimit} renderHeader={renderHeader} />
      ) : (
        <>
          {renderHeader()}
          {widok === 'analityka' ? (
            <BudgetAnalyticsView month={selectedMonth} onMonthChange={setSelectedMonth} />
          ) : (
            <BudgetReportsView month={selectedMonth} />
          )}
        </>
      )}
    </Page>
  );
}

interface WydatkiViewProps {
  writer: boolean;
  canEditLimit: boolean;
  /** Limit miesięczny (`useMonthlyBudgetLimit`). */
  budget: MonthlyBudgetLimit;
  month: string;
  onMonthChange: (month: string) => void;
  renderHeader: HeaderRenderer;
}

function WydatkiView({ writer, canEditLimit, budget, month: selectedMonth, onMonthChange, renderHeader }: WydatkiViewProps) {
  const [openId, clearOpen] = useOpenParam();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OfficeExpenseWithRelations | null>(null);
  const [viewing, setViewing] = useState<OfficeExpenseWithRelations | null>(null);
  const [deleting, setDeleting] = useState<OfficeExpenseWithRelations | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);
  // Id z `?open=` już obsłużony (otwarty lub zgłoszony jako brak) - bez ponownego otwierania.
  const [handledOpenId, setHandledOpenId] = useState<string | null>(null);

  const monthRange = useMemo(() => monthRangeIso(selectedMonth), [selectedMonth]);

  // Wydatki w wybranym miesiacu (filtry user-side: kategoria + search) - to widoczna lista.
  const filteredQuery = useExpenses({
    ...filters,
    dateFrom: monthRange.from,
    dateTo: monthRange.to,
  });
  const expenses = useMemo(() => filteredQuery.data ?? [], [filteredQuery.data]);

  // Suma calkowita w miesiacu (bez filtrow) - do progres baru. Bez filtrow zeby
  // wskaznik nie zmienial sie gdy user zawezi widok.
  const monthTotalQuery = useExpenses({
    dateFrom: monthRange.from,
    dateTo: monthRange.to,
  });
  const yearTotalQuery = useExpenses({ dateFrom: startOfYearIso() });

  const monthSpent = useMemo(() => sumExpenses(monthTotalQuery.data ?? []), [monthTotalQuery.data]);
  const yearSpent = useMemo(() => sumExpenses(yearTotalQuery.data ?? []), [yearTotalQuery.data]);
  const filteredSum = useMemo(() => sumExpenses(expenses), [expenses]);

  const isCurrentMonth = selectedMonth === currentMonthIso();

  // Deep-link `?open=<id>`: najpierw szukamy w załadowanym miesiącu, w razie braku - pobranie po id.
  const pendingOpenId = openId && openId !== handledOpenId ? openId : null;
  const listsReady = !filteredQuery.isLoading && !monthTotalQuery.isLoading;
  const loadedMatch = useMemo(
    () =>
      pendingOpenId
        ? (monthTotalQuery.data ?? []).find((e) => e.id === pendingOpenId) ??
          expenses.find((e) => e.id === pendingOpenId) ??
          null
        : null,
    [pendingOpenId, monthTotalQuery.data, expenses],
  );
  const byIdQuery = useExpense(pendingOpenId && listsReady && !loadedMatch ? pendingOpenId : null);

  useEffect(() => {
    if (!openId) {
      setHandledOpenId(null);
      return;
    }
    if (!pendingOpenId || !listsReady) return;

    const target = loadedMatch ?? byIdQuery.data;
    if (target) {
      setHandledOpenId(pendingOpenId);
      // Pokaż wydatek w kontekście jego miesiąca (lista + KPI).
      const month = target.expense_date.slice(0, 7);
      if (month !== selectedMonth && month <= currentMonthIso()) onMonthChange(month);
      if (writer) {
        setEditing(target);
        setFormOpen(true);
      } else {
        setViewing(target);
      }
      return;
    }
    if (byIdQuery.isError || (byIdQuery.isSuccess && byIdQuery.data === null)) {
      setHandledOpenId(pendingOpenId);
      toast.error('Nie znaleziono wydatku lub brak dostępu');
      clearOpen();
    }
  }, [
    openId,
    pendingOpenId,
    listsReady,
    loadedMatch,
    byIdQuery.data,
    byIdQuery.isError,
    byIdQuery.isSuccess,
    selectedMonth,
    onMonthChange,
    writer,
    clearOpen,
  ]);

  const handleAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const handleEdit = (e: OfficeExpenseWithRelations) => {
    setEditing(e);
    setFormOpen(true);
  };

  const handleOpen = (e: OfficeExpenseWithRelations) => {
    if (writer) handleEdit(e);
    else setViewing(e);
  };

  const handleFormOpenChange = (open: boolean) => {
    setFormOpen(open);
    if (!open && openId) clearOpen();
  };

  const handleDetailsClose = () => {
    setViewing(null);
    if (openId) clearOpen();
  };

  const canAdd = writer && isCurrentMonth;

  return (
    <>
      {renderHeader(
        (canEditLimit || canAdd) && (
          // Jedna grupa: w wąskim module przyciski stoją razem w wierszu (na telefonie po równo), a przy
          // powiększonym tekście zawijają się zamiast wystawać poza ekran.
          <div className="flex w-full flex-wrap gap-2 @sm:w-auto @sm:flex-nowrap">
            {canEditLimit && (
              // Przy błędzie odczytu okno pokazałoby domyślny limit i mogłoby nadpisać prawdziwy.
              <Button
                variant="outline"
                className="flex-1 @sm:flex-none"
                onClick={() => setLimitOpen(true)}
                disabled={budget.isLoading || budget.isError}
                title={budget.isError ? 'Nie udało się wczytać limitu - odśwież stronę' : undefined}
              >
                <Target />
                Ustaw limit
              </Button>
            )}
            {canAdd && (
              <Button className="flex-1 @sm:flex-none" onClick={handleAdd}>
                <Plus />
                Dodaj wydatek
              </Button>
            )}
          </div>
        ),
      )}

      {!isCurrentMonth && writer && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          Przeglądasz miesiąc archiwalny. Aby dodać wydatek do bieżącego koszyka, wróć na bieżący miesiąc.
        </div>
      )}

      <BudgetProgressCard
        yearMonth={selectedMonth}
        spent={monthSpent}
        budget={budget.limit}
        isLoading={monthTotalQuery.isLoading || budget.isLoading}
      >
        <BudgetKpiCard
          label={`Rok ${currentYearIso()} narastająco`}
          icon={CalendarRange}
          value={formatPLN(yearSpent)}
          isLoading={yearTotalQuery.isLoading}
          hint="Suma od 1 stycznia"
        />
      </BudgetProgressCard>

      <section aria-label="Lista wydatków" className="space-y-3">
        <div className="flex flex-col gap-2 @lg:flex-row @lg:items-center @lg:justify-between">
          <ExpensesFilters value={filters} onChange={setFilters} />
          {filteredQuery.isLoading ? (
            <Skeleton className="h-4 w-48" />
          ) : (
            <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
              Znaleziono: {expenses.length}
              {expenses.length >= 500 ? ' (limit 500)' : ''}
              <span className="mx-1.5" aria-hidden>
                ·
              </span>
              Suma w widoku: <span className="font-semibold text-foreground">{formatPLN(filteredSum)}</span>
            </p>
          )}
        </div>

        <ExpensesList
          expenses={expenses}
          isLoading={filteredQuery.isLoading}
          onOpen={handleOpen}
          onEdit={handleEdit}
          onDelete={setDeleting}
          onAdd={canAdd ? handleAdd : undefined}
        />
      </section>

      <ExpenseFormDialog open={formOpen} onOpenChange={handleFormOpenChange} expense={editing} />
      <ExpenseDetailsDialog expense={viewing} onClose={handleDetailsClose} />
      <DeleteExpenseDialog expense={deleting} onClose={() => setDeleting(null)} />
      {canEditLimit && (
        <BudgetLimitDialog open={limitOpen} onOpenChange={setLimitOpen} currentLimit={budget.limit} />
      )}
    </>
  );
}

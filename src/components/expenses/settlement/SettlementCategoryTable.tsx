import { useMemo } from 'react';
import { Tags } from 'lucide-react';
import { toast } from 'sonner';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/search-select';
import { ExpenseCategoryPill } from '@/components/expenses/ExpenseCategoryPill';
import { AnalyticsCard, ShareBar } from '@/components/expenses/analytics/AnalyticsUi';
import { sharePercent } from '@/components/expenses/analytics/derive';
import { useSetCategorySettlementItem } from '@/hooks/useBudgetSettlement';
import type { BudgetYearCategoryTotal, ExpenseCategory } from '@/integrations/supabase/types';
import { errorMessage } from '@/lib/errors';
import { expenseCategoryClasses, formatPLN } from '@/lib/expenses';
import {
  SETTLEMENT_ITEMS,
  isSettlementItemCode,
  settlementItemShortLabel,
  type SettlementItemCode,
} from '@/lib/settlement';
import { useMpForms } from '@/hooks/useMpForms';
import { cn } from '@/lib/utils';

const ITEM_OPTIONS: SearchSelectOption[] = SETTLEMENT_ITEMS.map((item) => ({
  value: item.code,
  label: `${item.code}. ${item.short}`,
  keywords: item.label,
}));

interface Props {
  categories: ExpenseCategory[];
  totals: BudgetYearCategoryTotal[];
  yearTotal: number;
  canEdit: boolean;
}

interface Row {
  category: ExpenseCategory | null;
  total: number;
  count: number;
  missing: number;
}

/** Kategorie roku: kwota, udział, braki faktur i przypisana pozycja sprawozdania. */
export function SettlementCategoryTable({ categories, totals, yearTotal, canEdit }: Props) {
  const setItem = useSetCategorySettlementItem();
  const mp = useMpForms();

  // Wszystkie kategorie (przypisanie także przed pierwszym wydatkiem) + wiersz wydatków bez kategorii.
  const rows = useMemo<Row[]>(() => {
    const byId = new Map(totals.map((t) => [t.category_id, t]));
    const list: Row[] = categories.map((category) => {
      const t = byId.get(category.id);
      return { category, total: Number(t?.total ?? 0), count: t?.count ?? 0, missing: t?.missing_invoice_count ?? 0 };
    });
    const uncategorized = byId.get(null);
    if (uncategorized) {
      list.push({
        category: null,
        total: Number(uncategorized.total),
        count: uncategorized.count,
        missing: uncategorized.missing_invoice_count,
      });
    }
    return list.sort((a, b) => b.total - a.total || (a.category?.name ?? '').localeCompare(b.category?.name ?? '', 'pl'));
  }, [categories, totals]);

  const change = (category: ExpenseCategory, value: string | null) => {
    const item: SettlementItemCode | null = isSettlementItemCode(value) ? value : null;
    const current = isSettlementItemCode(category.settlement_item) ? category.settlement_item : null;
    if (item === current) return;
    setItem.mutate(
      { categoryId: category.id, item },
      {
        onSuccess: () =>
          toast.success(
            item ? `${category.name} → poz. ${settlementItemShortLabel(item)}` : `${category.name}: bez pozycji`,
          ),
        onError: (err) => toast.error('Nie udało się zapisać pozycji', { description: errorMessage(err) }),
      },
    );
  };

  return (
    <AnalyticsCard
      title="Kategorie"
      icon={Tags}
      description={
        canEdit
          ? 'Suma roku w kategoriach. Każdej kategorii przypisz pozycję sprawozdania z wydatkowania ryczałtu.'
          : `Suma roku w kategoriach i pozycje sprawozdania (przypisuje ${mp.nominative} lub Administrator).`
      }
      aside={<span className="text-sm font-semibold tabular-nums">{formatPLN(yearTotal)}</span>}
    >
      <ul className="divide-y" aria-label="Kategorie wydatków w roku">
        {rows.map((row) => {
          const share = sharePercent(row.total, yearTotal);
          const category = row.category;
          const code = category?.settlement_item ?? null;
          const pending = setItem.isPending && setItem.variables?.categoryId === category?.id;
          return (
            <li
              key={category?.id ?? 'none'}
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-2.5 @lg:grid-cols-[minmax(0,1fr)_7.5rem_15rem]',
                row.count === 0 && 'opacity-60',
              )}
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <ExpenseCategoryPill category={category} />
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {row.count} dok.
                    {row.missing > 0 && (
                      <span className="text-amber-700 dark:text-amber-300"> · {row.missing} bez faktury</span>
                    )}
                  </span>
                </div>
                {row.total > 0 && (
                  <ShareBar
                    percent={share}
                    className={expenseCategoryClasses(category?.color).dot}
                    label={`Udział ${category?.name ?? 'wydatków bez kategorii'} w roku: ${share.toFixed(0)}%`}
                  />
                )}
              </div>
              <div className="text-right tabular-nums">
                <span className="text-sm font-semibold">{formatPLN(row.total)}</span>
                <span className="block text-[11px] text-muted-foreground">{share.toFixed(0)}% roku</span>
              </div>
              <div className="col-span-2 min-w-0 @lg:col-span-1">
                {!category ? (
                  <p className="text-xs text-muted-foreground">Nadaj kategorię wydatkom w widoku Wydatki</p>
                ) : canEdit ? (
                  <SearchSelect
                    aria-label={`Pozycja sprawozdania: ${category.name}`}
                    className={cn(
                      '[&_input]:text-xs',
                      !isSettlementItemCode(code) &&
                        row.count > 0 &&
                        '[&_input]:border-amber-500/60 [&_input]:placeholder:text-amber-800 dark:[&_input]:placeholder:text-amber-200',
                    )}
                    value={isSettlementItemCode(code) ? code : null}
                    onChange={(v) => change(category, v)}
                    disabled={pending}
                    noneLabel="Bez pozycji"
                    placeholder="Bez pozycji"
                    options={ITEM_OPTIONS}
                  />
                ) : (
                  <p
                    className={cn(
                      'truncate text-xs',
                      code ? 'text-foreground' : 'text-amber-700 dark:text-amber-300',
                    )}
                  >
                    {settlementItemShortLabel(code) ?? 'Bez pozycji'}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </AnalyticsCard>
  );
}

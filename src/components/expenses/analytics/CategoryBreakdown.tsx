import { Tags } from 'lucide-react';
import { ExpenseCategoryPill } from '@/components/expenses/ExpenseCategoryPill';
import { expenseCategoryClasses, formatPLN } from '@/lib/expenses';
import type { BudgetCategoryStat } from '@/integrations/supabase/types';
import { AnalyticsCard, DeltaBadge, EmptyHint, ShareBar } from './AnalyticsUi';
import { amountDelta, sharePercent } from './derive';

interface Props {
  categories: BudgetCategoryStat[];
  monthTotal: number;
}

/** Kategorie: bieżący miesiąc vs poprzedni i średnia 3 mies., udział w miesiącu. */
export function CategoryBreakdown({ categories, monthTotal }: Props) {
  return (
    <AnalyticsCard
      title="Kategorie"
      icon={Tags}
      description="Ten miesiąc vs poprzedni i średnia 3 wcześniejszych miesięcy."
    >
      {categories.length === 0 ? (
        <EmptyHint>Brak wydatków w tym miesiącu i trzech poprzednich.</EmptyHint>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">Kategoria</th>
              <th className="whitespace-nowrap pb-2 pr-3 text-right font-medium @max-sm:pr-0">Ten miesiąc</th>
              <th className="hidden pb-2 pr-3 text-right font-medium @lg:table-cell">Poprzedni</th>
              <th className="hidden pb-2 pr-3 text-right font-medium @lg:table-cell">Śr. 3 mies.</th>
              <th className="hidden pb-2 text-right font-medium @sm:table-cell">Zmiana</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {categories.map((c) => {
              const share = sharePercent(c.current, monthTotal);
              return (
                <tr key={c.id ?? 'none'} className="align-top">
                  {/* w-full + max-w-0: kolumna kategorii oddaje miejsce kwotom, a długa nazwa skraca się zamiast rozpychać tabelę poza kartę. */}
                  <td className="w-full max-w-0 py-2.5 pr-3">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <ExpenseCategoryPill
                          className="min-w-0"
                          category={c.id === null ? null : { id: c.id, name: c.name, color: c.color }}
                        />
                        {c.count > 0 && (
                          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{c.count} wyd.</span>
                        )}
                      </div>
                      <ShareBar
                        percent={share}
                        className={expenseCategoryClasses(c.color).dot}
                        label={`Udział ${c.name} w miesiącu: ${share.toFixed(0)}%`}
                      />
                      <span className="text-[11px] text-muted-foreground tabular-nums @lg:hidden">
                        Poprz. {formatPLN(c.previous)} · śr. {formatPLN(c.avg3)}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums @max-sm:pr-0">
                    <span className="font-semibold">{formatPLN(c.current)}</span>
                    <span className="block text-[11px] text-muted-foreground">{share.toFixed(0)}% miesiąca</span>
                    {/* Telefon: zmiana pod kwotą zamiast osobnej kolumny. */}
                    <span className="mt-1 flex justify-end @sm:hidden">
                      <DeltaBadge
                        delta={amountDelta(c.current, c.previous)}
                        title={`vs poprzedni miesiąc: ${formatPLN(c.previous)}`}
                      />
                    </span>
                  </td>
                  <td className="hidden py-2.5 pr-3 text-right tabular-nums text-muted-foreground @lg:table-cell">
                    {formatPLN(c.previous)}
                  </td>
                  <td className="hidden py-2.5 pr-3 text-right tabular-nums text-muted-foreground @lg:table-cell">
                    {formatPLN(c.avg3)}
                  </td>
                  <td className="hidden py-2.5 text-right @sm:table-cell">
                    <DeltaBadge
                      delta={amountDelta(c.current, c.previous)}
                      title={`vs poprzedni miesiąc: ${formatPLN(c.previous)}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </AnalyticsCard>
  );
}

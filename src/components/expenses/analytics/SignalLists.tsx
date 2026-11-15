import type { ReactNode } from 'react';
import { Banknote, Copy, Repeat, TrendingUp } from 'lucide-react';
import { formatPLN } from '@/lib/expenses';
import type {
  BudgetAnomaly,
  BudgetDuplicate,
  BudgetFeeExpense,
  BudgetRecurringCost,
} from '@/integrations/supabase/types';
import { AnalyticsCard, EmptyHint, ExpenseLink } from './AnalyticsUi';
import { formatShortDate } from './derive';

/** Wiersz listy sygnałów: treść + metadane po lewej, kwota po prawej. */
function SignalRow({ main, meta, amount, note }: { main: ReactNode; meta?: ReactNode; amount: ReactNode; note?: ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col">
        {main}
        {meta && <span className="truncate text-[11px] text-muted-foreground">{meta}</span>}
      </div>
      <div className="shrink-0 text-right">
        <span className="font-semibold tabular-nums">{amount}</span>
        {note && <span className="block text-[11px] text-muted-foreground tabular-nums">{note}</span>}
      </div>
    </li>
  );
}

const joinMeta = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');

export function RecurringCosts({ items }: { items: BudgetRecurringCost[] }) {
  const monthly = items.reduce((sum, r) => sum + r.avg_amount, 0);
  return (
    <AnalyticsCard
      title="Koszty stałe"
      icon={Repeat}
      description="Kontrahenci obecni w co najmniej 3 z 6 ostatnich miesięcy."
      aside={items.length > 0 && <span title="Suma średnich miesięcznych">≈ {formatPLN(monthly)} / mies.</span>}
    >
      {items.length === 0 ? (
        <EmptyHint>Brak powtarzających się kontrahentów.</EmptyHint>
      ) : (
        <ul className="divide-y">
          {items.map((r) => (
            <SignalRow
              key={r.vendor}
              main={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium" title={r.vendor}>
                    {r.vendor}
                  </span>
                  {!r.in_current && (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      brak w tym miesiącu
                    </span>
                  )}
                </span>
              }
              meta={joinMeta([
                r.category,
                `${r.months_present} z 6 mies.`,
                `ostatnio ${formatPLN(r.last_amount)} (${formatShortDate(r.last_date)})`,
              ])}
              amount={formatPLN(r.avg_amount)}
              note="śr. / mies."
            />
          ))}
        </ul>
      )}
    </AnalyticsCard>
  );
}

export function PossibleDuplicates({ items }: { items: BudgetDuplicate[] }) {
  return (
    <AnalyticsCard
      title="Możliwe duplikaty"
      icon={Copy}
      description="Ta sama kwota i kontrahent (lub tytuł) w odstępie do 7 dni."
      aside={items.length > 0 && items.length}
    >
      {items.length === 0 ? (
        <EmptyHint>Nie wykryto podwójnych wpisów.</EmptyHint>
      ) : (
        <ul className="divide-y">
          {items.map((d) => (
            <SignalRow
              key={d.ids.join('-')}
              main={
                <span className="truncate font-medium" title={d.title}>
                  {d.title}
                </span>
              }
              meta={
                <span className="flex flex-wrap items-center gap-x-1.5">
                  {d.vendor && <span>{d.vendor} ·</span>}
                  <ExpenseLink id={d.ids[0]} className="font-normal underline">
                    {formatShortDate(d.dates[0])}
                  </ExpenseLink>
                  <span aria-hidden>i</span>
                  <ExpenseLink id={d.ids[1]} className="font-normal underline">
                    {formatShortDate(d.dates[1])}
                  </ExpenseLink>
                </span>
              }
              amount={formatPLN(d.amount)}
              note="każdy"
            />
          ))}
        </ul>
      )}
    </AnalyticsCard>
  );
}

export function Anomalies({ items }: { items: BudgetAnomaly[] }) {
  return (
    <AnalyticsCard
      title="Nietypowo wysokie wydatki"
      icon={TrendingUp}
      description="Co najmniej 2× mediana kategorii z 6 poprzednich miesięcy."
      aside={items.length > 0 && items.length}
    >
      {items.length === 0 ? (
        <EmptyHint>Brak wydatków odstających od historii kategorii.</EmptyHint>
      ) : (
        <ul className="divide-y">
          {items.map((a) => (
            <SignalRow
              key={a.id}
              main={<ExpenseLink id={a.id}>{a.title}</ExpenseLink>}
              meta={joinMeta([formatShortDate(a.expense_date), a.category ?? 'Bez kategorii', a.vendor])}
              amount={formatPLN(a.amount)}
              note={`×${a.ratio.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} mediany (${formatPLN(a.median)})`}
            />
          ))}
        </ul>
      )}
    </AnalyticsCard>
  );
}

export function Fees({ items }: { items: BudgetFeeExpense[] }) {
  const total = items.reduce((sum, f) => sum + f.amount, 0);
  return (
    <AnalyticsCard
      title="Opłaty, prowizje, abonamenty"
      icon={Banknote}
      description="Wydatki, których tytuł lub opis wskazuje na opłaty dodatkowe."
      aside={items.length > 0 && formatPLN(total)}
    >
      {items.length === 0 ? (
        <EmptyHint>Brak opłat i prowizji w tym miesiącu.</EmptyHint>
      ) : (
        <ul className="divide-y">
          {items.map((f) => (
            <SignalRow
              key={f.id}
              main={<ExpenseLink id={f.id}>{f.title}</ExpenseLink>}
              meta={joinMeta([formatShortDate(f.expense_date), f.vendor])}
              amount={formatPLN(f.amount)}
            />
          ))}
        </ul>
      )}
    </AnalyticsCard>
  );
}

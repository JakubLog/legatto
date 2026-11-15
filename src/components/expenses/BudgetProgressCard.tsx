import type { ReactNode } from 'react';
import { AlertTriangle, PiggyBank, Target, Wallet } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import {
  BUDGET_LEVEL_CLASSES,
  budgetLevel,
  budgetUsagePercent,
  formatMonthLabel,
  formatPercent1,
  formatPLN,
  type BudgetLevel,
} from '@/lib/expenses';
import { BudgetKpiCard } from './BudgetKpiCard';

interface Props {
  yearMonth: string;
  spent: number;
  /** Miesięczny limit (`useMonthlyBudgetLimit`). */
  budget: number;
  isLoading?: boolean;
  /** Dodatkowe kafelki KPI w tej samej siatce (np. rok-do-daty). */
  children?: ReactNode;
}

const REMAINING_HINT: Record<BudgetLevel, string> = {
  ok: 'Koszyk pod kontrolą',
  warning: 'Ponad 60% limitu wykorzystane',
  critical: 'Zbliżasz się do limitu',
  over: 'Limit miesięczny przekroczony',
};

export function BudgetProgressCard({
  yearMonth,
  spent,
  budget,
  isLoading = false,
  children,
}: Props) {
  const percent = budgetUsagePercent(spent, budget);
  const level = budgetLevel(spent, budget);
  const levelClasses = BUDGET_LEVEL_CLASSES[level];
  const overBudget = level === 'over';

  // Wąski moduł (telefon lub panel PoliAI): kafelek miesiąca na całą szerokość, pozostałe po dwa w wierszu, "Limit miesięczny"
  // ukryty (jest w opisie strony). Flex z podstawą 10rem zamiast stałych 2 kolumn: przy powiększonym tekście (rem)
  // kafelki same przechodzą do jednej kolumny, zamiast łamać kwoty w środku liczby.
  return (
    <section
      aria-label="Koszyk miesięczny"
      className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:grow [&>*]:basis-40 @md:grid @md:grid-cols-2 @lg:grid-cols-4"
    >
      <BudgetKpiCard
        className="@max-md:!basis-full"
        label={<span className="capitalize">Wydano · {formatMonthLabel(yearMonth)}</span>}
        icon={Wallet}
        value={formatPLN(spent)}
        isLoading={isLoading}
        hint={
          <span className="tabular-nums">
            <span className={levelClasses.text}>{formatPercent1(percent)}</span> limitu wykorzystane
          </span>
        }
      >
        <Progress
          value={percent}
          indicatorClassName={levelClasses.bar}
          className="mt-3 h-2"
          aria-label="Wykorzystanie koszyka miesięcznego"
        />
      </BudgetKpiCard>

      <BudgetKpiCard
        label={overBudget ? 'Przekroczono o' : 'Pozostało'}
        icon={overBudget ? AlertTriangle : PiggyBank}
        value={formatPLN(overBudget ? spent - budget : budget - spent)}
        valueClassName={levelClasses.text}
        iconClassName={levelClasses.soft}
        isLoading={isLoading}
        hint={REMAINING_HINT[level]}
      />

      <BudgetKpiCard
        className="@max-md:hidden"
        label="Limit miesięczny"
        icon={Target}
        value={formatPLN(budget)}
        hint="Koszyk = miesiąc kalendarzowy"
      />

      {children}
    </section>
  );
}

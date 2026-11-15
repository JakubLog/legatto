import { CheckCircle2, Coins, CreditCard, FileWarning } from 'lucide-react';
import { PAYMENT_METHOD_LABELS, formatPercent1, formatPLN } from '@/lib/expenses';
import { cn } from '@/lib/utils';
import type { BudgetAnalytics } from '@/integrations/supabase/types';
import { AnalyticsCard, EmptyHint, ShareBar } from './AnalyticsUi';
import { sharePercent } from './derive';

export function SmallExpenses({ small, monthTotal }: { small: BudgetAnalytics['small_expenses']; monthTotal: number }) {
  const share = sharePercent(small.total, monthTotal);
  return (
    <AnalyticsCard title="Drobne wydatki" icon={Coins} description="Wydatki poniżej 100 zł - pojedynczo niewidoczne, razem mogą ważyć.">
      {small.count === 0 ? (
        <EmptyHint>Brak wydatków poniżej 100 zł w tym miesiącu.</EmptyHint>
      ) : (
        <div className="space-y-2">
          <p className="flex items-baseline justify-between gap-3 text-sm">
            <span>
              <span className="text-lg font-semibold tabular-nums">{small.count}</span>{' '}
              <span className="text-muted-foreground">wydatków</span>
            </span>
            <span className="font-semibold tabular-nums">{formatPLN(small.total)}</span>
          </p>
          <ShareBar percent={share} label={`Udział drobnych wydatków w miesiącu: ${share.toFixed(0)}%`} />
          <p className="text-[11px] text-muted-foreground tabular-nums">{formatPercent1(share)} wydatków miesiąca</p>
        </div>
      )}
    </AnalyticsCard>
  );
}

export function DataQuality({ quality }: { quality: BudgetAnalytics['data_quality'] }) {
  const rows = [
    {
      label: 'Bez skanu paragonu lub faktury',
      count: quality.no_receipt_count,
      note: quality.no_receipt_count > 0 ? `na ${formatPLN(quality.no_receipt_sum)}` : null,
    },
    { label: 'Bez kategorii', count: quality.no_category_count, note: null },
    { label: 'Bez kontrahenta', count: quality.no_vendor_count, note: null },
    { label: 'Bez numeru faktury', count: quality.no_invoice_count, note: null },
  ];

  return (
    <AnalyticsCard
      title="Kompletność dokumentacji"
      icon={FileWarning}
      description={`Wydatków w miesiącu: ${quality.total_count}`}
    >
      {quality.total_count === 0 ? (
        <EmptyHint>Brak wydatków w tym miesiącu.</EmptyHint>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
              <span className="flex min-w-0 items-center gap-2">
                {r.count === 0 ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                ) : (
                  <FileWarning className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                )}
                <span className="truncate">{r.label}</span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className={cn('font-semibold', r.count > 0 && 'text-amber-700 dark:text-amber-400')}>
                  {r.count} / {quality.total_count}
                </span>
                {r.note && <span className="block text-[11px] text-muted-foreground">{r.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </AnalyticsCard>
  );
}

export function PaymentMethods({ methods, monthTotal }: { methods: BudgetAnalytics['payment_methods']; monthTotal: number }) {
  return (
    <AnalyticsCard title="Metody płatności" icon={CreditCard} description="Podział wydatków miesiąca.">
      {methods.length === 0 ? (
        <EmptyHint>Brak wydatków w tym miesiącu.</EmptyHint>
      ) : (
        <ul className="space-y-3">
          {methods.map((m) => {
            const label = m.method ? PAYMENT_METHOD_LABELS[m.method] : 'Nie podano';
            const share = sharePercent(m.total, monthTotal);
            return (
              <li key={m.method ?? 'none'} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{label}</span>
                  <span className="tabular-nums">
                    <span className="font-semibold">{formatPLN(m.total)}</span>
                    <span className="ml-1.5 text-[11px] text-muted-foreground">
                      {m.count} wyd. · {share.toFixed(0)}%
                    </span>
                  </span>
                </div>
                <ShareBar percent={share} label={`${label}: ${share.toFixed(0)}% wydatków`} />
              </li>
            );
          })}
        </ul>
      )}
    </AnalyticsCard>
  );
}

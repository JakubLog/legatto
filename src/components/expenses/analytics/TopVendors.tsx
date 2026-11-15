import { Store } from 'lucide-react';
import { formatPLN } from '@/lib/expenses';
import type { BudgetVendorStat } from '@/integrations/supabase/types';
import { AnalyticsCard, DeltaBadge, EmptyHint, ShareBar } from './AnalyticsUi';
import { amountDelta, sharePercent } from './derive';

/** Top 10 kontrahentów miesiąca vs poprzedni miesiąc. */
export function TopVendors({ vendors }: { vendors: BudgetVendorStat[] }) {
  const max = Math.max(0, ...vendors.map((v) => v.current));

  return (
    <AnalyticsCard title="Najwięksi kontrahenci" icon={Store} description="Top 10 w tym miesiącu vs poprzedni miesiąc.">
      {vendors.length === 0 ? (
        <EmptyHint>Brak wydatków z podanym kontrahentem w tym miesiącu.</EmptyHint>
      ) : (
        <ol className="space-y-3">
          {vendors.map((v) => (
            <li key={v.vendor} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium" title={v.vendor}>
                  {v.vendor}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-semibold tabular-nums">{formatPLN(v.current)}</span>
                  <DeltaBadge
                    delta={amountDelta(v.current, v.previous)}
                    title={`vs poprzedni miesiąc: ${formatPLN(v.previous)}`}
                  />
                </span>
              </div>
              <ShareBar percent={sharePercent(v.current, max)} label={`${v.vendor}: ${formatPLN(v.current)}`} />
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {v.count} wyd. · poprzedni miesiąc {formatPLN(v.previous)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </AnalyticsCard>
  );
}

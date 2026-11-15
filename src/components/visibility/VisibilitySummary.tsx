import { useMemo } from 'react';
import type { PowiatVisibilityStats } from '@/integrations/supabase/types';
import { Skeleton } from '@/components/ui/skeleton';
import { visibilityStatus, type VisibilityStatus } from '@/lib/visibility';
import { VISIBILITY_ORDER, VisibilityStatusPill } from '@/components/visibility/VisibilityStatusPill';

interface Props {
  stats: PowiatVisibilityStats[];
  isLoading: boolean;
  thresholdDays: number;
}

/** Pasek podsumowania: pokrycie okręgu + liczniki powiatów per status. */
export function VisibilitySummary({ stats, isLoading, thresholdDays }: Props) {
  const summary = useMemo(() => {
    const counts: Record<VisibilityStatus, number> = { green: 0, yellow: 0, red: 0, unknown: 0 };
    for (const s of stats) counts[visibilityStatus(s.days_since_last_event, thresholdDays)] += 1;
    const total = stats.length;
    const greenOrYellow = total - counts.red;
    const pct = total > 0 ? Math.round((greenOrYellow / total) * 100) : 0;
    return { counts, total, greenOrYellow, pct };
  }, [stats, thresholdDays]);

  if (isLoading) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
        <Skeleton className="h-6 w-72 max-w-full" />
        <Skeleton className="h-2 w-full rounded-full" />
      </div>
    );
  }

  return (
    <section aria-label="Podsumowanie widoczności" className="space-y-3 rounded-xl border bg-card p-4 shadow-sm max-md:p-3">
      <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center @sm:justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="mr-1 text-xl font-semibold tabular-nums text-foreground">
            {summary.greenOrYellow}
            <span className="text-muted-foreground"> / {summary.total}</span>
          </span>
          powiatów z obecnością w ostatnich {thresholdDays} dniach
        </p>
        <div className="flex flex-wrap gap-1.5">
          {VISIBILITY_ORDER.filter((st) => st !== 'unknown' || summary.counts.unknown > 0).map((st) => (
            <VisibilityStatusPill key={st} status={st} count={summary.counts[st]} />
          ))}
        </div>
      </div>
      <div
        role="progressbar"
        aria-label="Pokrycie okręgu"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={summary.pct}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${summary.pct}%` }} />
      </div>
    </section>
  );
}

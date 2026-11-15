import { Info } from 'lucide-react';
import { useMyEngagement } from '@/hooks/useDashboardStats';
import { Skeleton } from '@/components/ui/skeleton';

const HINT = 'Im większy procent, tym większe twoje zaangażowanie w sprawy biura - ciśnij!';

/** Procent zaangażowania obok powitania na dashboardzie, z dymkiem objaśnienia. */
export function EngagementScore() {
  const { data, isLoading, isError } = useMyEngagement();

  if (isLoading) return <Skeleton className="h-6 w-16 shrink-0 rounded-full" />;
  if (isError || data === undefined) return null;

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs font-semibold tabular-nums text-brand md:px-2.5 md:text-sm">
      {data}%
      <span className="group relative inline-flex">
        <button
          type="button"
          aria-label={HINT}
          className="rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
        </button>
        {/* Zamknięty dymek jest `hidden` (nie `invisible`), żeby nie poszerzał obszaru przewijania;
            na telefonie wyrównany do prawej krawędzi ikony, żeby nie wychodził poza ekran. */}
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border bg-popover px-3 py-2 text-xs font-normal text-popover-foreground shadow-md group-focus-within:block group-hover:block max-md:left-auto max-md:-right-2 max-md:w-56 max-md:translate-x-0"
        >
          {HINT}
        </span>
      </span>
    </span>
  );
}

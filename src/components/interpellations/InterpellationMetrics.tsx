import { ArrowDownRight, ArrowUpRight, FilePlus2, MessageSquareText, Send, Timer } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type {
  InterpellationMetrics as Metrics,
  InterpellationSpeedMetric,
  InterpellationSpeedMetricName,
} from '@/hooks/useInterpellationMetrics';

const SPEED_CARDS: Array<{
  metric: InterpellationSpeedMetricName;
  label: string;
  icon: typeof Timer;
  iconClassName: string;
}> = [
  {
    metric: 'submission_to_sent',
    label: 'Szybkość od złożenia do wysłania',
    icon: Send,
    iconClassName: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  },
  {
    metric: 'acceptance_to_sent',
    label: 'Szybkość od akceptacji do wysłania',
    icon: Timer,
    iconClassName: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  {
    metric: 'feedback_to_revision',
    label: 'Szybkość od uwag do poprawek',
    icon: MessageSquareText,
    iconClassName: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
];

/** Polska forma liczebnika: 1 → one, 2-4 (bez 12-14) → few, reszta → many. */
function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  const mod10 = count % 10;
  const mod100 = count % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'Brak danych';
  if (seconds < 60) return '< 1 min';
  if (seconds < 3_600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(seconds / 3_600)} godz.`;
  return `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(seconds / 86_400)} dni`;
}

function Trend({ metric }: { metric: InterpellationSpeedMetric }) {
  if (metric.averageSeconds === null) {
    return <span className="text-muted-foreground">Brak zakończonych etapów w tym tygodniu</span>;
  }
  if (metric.previousAverageSeconds === null) {
    return <span className="text-muted-foreground">Brak danych z poprzedniego tygodnia</span>;
  }
  if (metric.trendPercent === null) {
    return (
      <span className="inline-flex items-center gap-1 text-destructive">
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        Wolniej niż w poprzednim tygodniu
      </span>
    );
  }
  if (metric.trendPercent === 0) {
    return <span className="text-muted-foreground">Bez zmian względem poprzedniego tygodnia</span>;
  }

  const faster = metric.trendPercent > 0;
  const Icon = faster ? ArrowDownRight : ArrowUpRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        faster ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {Math.abs(metric.trendPercent)}% {faster ? 'szybciej' : 'wolniej'} względem poprzedniego tygodnia
    </span>
  );
}

function SpeedCard({
  config,
  metric,
}: {
  config: (typeof SPEED_CARDS)[number];
  metric: InterpellationSpeedMetric;
}) {
  const Icon = config.icon;
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-card">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', config.iconClassName)}>
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </div>
        <h2 className="text-sm font-medium leading-snug text-muted-foreground">{config.label}</h2>
      </div>
      <div className="space-y-1">
        <p
          className={cn(
            'text-2xl font-semibold tabular-nums tracking-tight',
            metric.averageSeconds === null && 'text-muted-foreground',
          )}
        >
          {formatDuration(metric.averageSeconds)}
        </p>
        <p className="text-xs">
          <Trend metric={metric} />
        </p>
        {/* Bez pomiarów Trend mówi już "Brak zakończonych etapów" - licznik 0 tylko by to powtarzał. */}
        {metric.averageSeconds !== null && (
          <p className="text-xs tabular-nums text-muted-foreground">
            {metric.sampleCount}{' '}
            {plural(metric.sampleCount, 'zakończony pomiar', 'zakończone pomiary', 'zakończonych pomiarów')} w tym
            tygodniu
          </p>
        )}
      </div>
    </article>
  );
}

export function InterpellationMetrics({ data, loading }: { data: Metrics | undefined; loading: boolean }) {
  if (loading || !data) {
    return (
      <section aria-label="Wskaźniki interpelacji" className="grid gap-3 @[30rem]:grid-cols-2 @[56rem]:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="space-y-3 rounded-xl border bg-card p-4 shadow-card">
            <Skeleton className="h-9 w-4/5" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </section>
    );
  }

  return (
    <section aria-label="Wskaźniki interpelacji" className="grid gap-3 @[30rem]:grid-cols-2 @[56rem]:grid-cols-4">
      {SPEED_CARDS.map((config) => (
        <SpeedCard key={config.metric} config={config} metric={data.speed[config.metric]} />
      ))}
      <article className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-card">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-400">
            <FilePlus2 className="h-[18px] w-[18px]" aria-hidden />
          </div>
          <h2 className="text-sm font-medium leading-snug text-muted-foreground">Interpelacje w tym tygodniu</h2>
        </div>
        <div className="space-y-1">
          <p className="text-2xl font-semibold tabular-nums tracking-tight">{data.createdThisWeek}</p>
          <p className="text-xs text-muted-foreground">
            {plural(data.createdThisWeek, 'utworzona', 'utworzone', 'utworzonych')} od poniedziałku, z czego wysłano{' '}
            <span className="tabular-nums">{data.sentPercent}%</span> (
            <span className="tabular-nums">{data.sentFromCreatedThisWeek}</span>{' '}
            {plural(data.sentFromCreatedThisWeek, 'sztuka', 'sztuki', 'sztuk')})
          </p>
        </div>
      </article>
    </section>
  );
}

import { ArrowDownRight, ArrowRight, ArrowUpRight, Sparkles } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { ErrorNotice } from '@/components/admin/AdminUi';
import { usePersonPulse } from '@/hooks/useModulePulse';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import type { PersonPulseMetric, PersonPulseRow } from '@/integrations/supabase/types';

const METRIC_LABELS: Record<PersonPulseMetric, string> = {
  active_days: 'Dni z logowaniem lub MCP',
  actions: 'Akcje w systemie',
  events_created: 'Dodane wydarzenia',
  cases_resolved: 'Załatwione sprawy',
  interpellations: 'Wgrane interpelacje',
  expenses_added: 'Wpisane wydatki',
};

/** Miary zawsze widoczne; pozostałe tylko gdy osoba coś w nich zrobiła w oknie analizy. */
const ALWAYS_SHOWN: PersonPulseMetric[] = ['active_days', 'actions'];

interface Props {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
}

/** Trend aktywności wybranej osoby: tydzień i miesiąc vs poprzedni (do tego samego momentu) + 8 tygodni. */
export function PersonTrend({ userId, fullName, avatarUrl }: Props) {
  const { data, isLoading, isError, error } = usePersonPulse(userId);

  const rows = (data ?? []).filter(
    (r) =>
      ALWAYS_SHOWN.includes(r.metric) ||
      r.this_month + r.prev_month + r.weekly.reduce((acc, v) => acc + v, 0) > 0,
  );

  return (
    <section aria-label={`Trend: ${fullName}`} className="rounded-2xl border bg-card p-5 shadow-card @sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <CreatorAvatar name={fullName} avatarUrl={avatarUrl} className="h-9 w-9" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{fullName}</p>
          <p className="text-xs text-muted-foreground">
            Trend aktywności · porównanie do tego samego momentu poprzedniego okresu
          </p>
        </div>
      </div>

      {isError && <ErrorNotice title="Nie udało się policzyć trendu" message={errorMessage(error)} />}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Miara</th>
                <th className="pb-2 font-medium">Ten tydzień</th>
                <th className="pb-2 font-medium">Ten miesiąc</th>
                <th className="pb-2 text-right font-medium">8 tygodni</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <MetricRow key={r.metric} row={r} />
              ))}
            </tbody>
          </table>
          {rows.length === ALWAYS_SHOWN.length && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Brak wydarzeń, spraw, interpelacji i wydatków tej osoby w ostatnich tygodniach.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function MetricRow({ row }: { row: PersonPulseRow }) {
  return (
    <tr>
      <td className="py-2.5 pr-3 font-medium">{METRIC_LABELS[row.metric]}</td>
      <td className="py-2.5 pr-3">
        <Comparison current={row.this_week} previous={row.prev_week} period="tydz." />
      </td>
      <td className="py-2.5 pr-3">
        <Comparison current={row.this_month} previous={row.prev_month} period="mies." />
      </td>
      <td className="py-2.5">
        <Sparkline values={row.weekly} />
      </td>
    </tr>
  );
}

function Comparison({ current, previous, period }: { current: number; previous: number; period: string }) {
  const diff = current - previous;
  const pct = previous > 0 ? Math.round((diff / previous) * 100) : null;
  const tone = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const Icon = tone === 'up' ? ArrowUpRight : tone === 'down' ? ArrowDownRight : ArrowRight;
  const label =
    tone === 'flat' ? 'bez zmian' : pct === null ? `+${diff}` : `${pct > 0 ? '+' : ''}${pct}%`;

  return (
    <span className="flex items-center gap-2">
      <span className="text-base font-semibold tabular-nums">{current}</span>
      <span
        title={`Poprzedni ${period}: ${previous}`}
        className={cn(
          'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
          tone === 'up' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
          tone === 'down' && 'bg-red-500/10 text-red-600 dark:text-red-400',
          tone === 'flat' && 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="h-3 w-3" aria-hidden />
        {label}
      </span>
      <span className="text-[11px] text-muted-foreground tabular-nums">vs {previous}</span>
    </span>
  );
}

/** Mini wykres 8 tygodni; ostatni punkt (bieżący, niepełny tydzień) wyróżniony. */
function Sparkline({ values }: { values: number[] }) {
  const width = 96;
  const height = 28;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => [i * step, height - 3 - (v / max) * (height - 6)] as const);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`-3 0 ${width + 6} ${height}`}
      className="ml-auto h-7 w-24 text-primary"
      role="img"
      aria-label={`Tygodniowo: ${values.join(', ')}`}
    >
      {first && last && (
        <polygon points={`${first[0]},${height} ${line} ${last[0]},${height}`} fill="currentColor" opacity="0.08" />
      )}
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      {points.length === 1 && first && <circle cx={first[0]} cy={first[1]} r="1.5" fill="currentColor" />}
      {last && <circle cx={last[0]} cy={last[1]} r="2.5" fill="currentColor" />}
    </svg>
  );
}

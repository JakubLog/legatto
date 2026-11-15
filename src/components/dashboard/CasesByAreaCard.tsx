import { MapPin } from 'lucide-react';
import type { CasesByArea } from '@/hooks/useDashboardStats';
import { DashboardSection, SectionEmpty, SectionRowsSkeleton } from '@/components/dashboard/DashboardSection';

const TOP = 5;

interface CasesByAreaCardProps {
  data: CasesByArea | undefined;
  loading: boolean;
  className?: string;
}

interface AreaRowProps {
  label: string;
  hint?: string;
  count: number;
  max: number;
  muted?: boolean;
}

function AreaRow({ label, hint, count, max, muted }: AreaRowProps) {
  return (
    <li className="space-y-1.5 px-4 py-2.5">
      <div className="flex min-w-0 items-baseline gap-2 text-sm">
        <span className={muted ? 'flex-1 truncate text-muted-foreground' : 'flex-1 truncate'}>{label}</span>
        {hint && <span className="hidden max-w-[50%] truncate text-xs text-muted-foreground @sm:inline">{hint}</span>}
        <span className="w-8 shrink-0 text-right font-medium tabular-nums">{count}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={muted ? 'h-full rounded-full bg-muted-foreground/40' : 'h-full rounded-full bg-primary'}
          style={{ width: `${max > 0 ? (count / max) * 100 : 0}%` }}
        />
      </div>
    </li>
  );
}

/** Sekcja "Sprawy w okręgu": aktywne sprawy według powiatu, z gminą, z której jest ich najwięcej. */
export function CasesByAreaCard({ data, loading, className }: CasesByAreaCardProps) {
  if (!loading && !data) return null;

  const top = data?.rows.slice(0, TOP) ?? [];
  const rest = data?.rows.slice(TOP) ?? [];
  const restCount = rest.reduce((sum, r) => sum + r.count, 0);
  const max = Math.max(top[0]?.count ?? 0, restCount, data?.unassigned ?? 0);

  return (
    <DashboardSection
      title="Sprawy w okręgu"
      icon={MapPin}
      to="/biuro/sprawy"
      count={data?.total}
      className={className}
    >
      {loading || !data ? (
        <SectionRowsSkeleton rows={4} />
      ) : data.total === 0 ? (
        <SectionEmpty icon={MapPin} message="Brak aktywnych spraw" />
      ) : (
        <ul className="divide-y py-1">
          {top.map((r) => (
            <AreaRow
              key={r.powiat_id}
              label={r.name}
              hint={r.top_gmina ? `najwięcej: ${r.top_gmina.name} (${r.top_gmina.count})` : undefined}
              count={r.count}
              max={max}
            />
          ))}
          {restCount > 0 && (
            <AreaRow label={`Pozostałe powiaty (${rest.length})`} count={restCount} max={max} muted />
          )}
          {data.unassigned > 0 && (
            <AreaRow label="Bez lokalizacji" count={data.unassigned} max={max} muted />
          )}
        </ul>
      )}
    </DashboardSection>
  );
}

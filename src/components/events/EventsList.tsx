import { useMemo, useState, type ComponentProps } from 'react';
import { format, isSameYear, isToday, isTomorrow, isYesterday, startOfDay } from 'date-fns';
import { pl } from 'date-fns/locale';
import { CalendarX2, ChevronDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EVENT_GROUP_LABELS, classifyEventDate } from '@/lib/events';
import type { CalendarEventWithRelations } from '@/integrations/supabase/types';
import { canWrite, isAdmin } from '@/lib/permissions';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { EventRow } from './EventRow';

interface Props {
  events: CalendarEventWithRelations[];
  isLoading: boolean;
  /** Aktywne filtry - zmienia komunikat pustego stanu. */
  filtered: boolean;
  onEdit: (e: CalendarEventWithRelations) => void;
  onDelete: (e: CalendarEventWithRelations) => void;
  /** Podane tylko dla użytkowników z prawem zapisu. */
  onAdd?: () => void;
}

interface DayGroup {
  key: string;
  day: Date;
  events: CalendarEventWithRelations[];
}

/** Grupuje wydarzenia po dniu startu z zachowaniem kolejności wejściowej. */
function groupByDay(events: CalendarEventWithRelations[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const e of events) {
    const day = startOfDay(new Date(e.starts_at));
    const key = day.toISOString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(e);
    else groups.push({ key, day, events: [e] });
  }
  return groups;
}

function relativeLabel(day: Date): string | null {
  if (isToday(day)) return EVENT_GROUP_LABELS.today;
  if (isTomorrow(day)) return EVENT_GROUP_LABELS.tomorrow;
  if (isYesterday(day)) return 'Wczoraj';
  return null;
}

export function EventsList({ events, isLoading, filtered, onEdit, onDelete, onAdd }: Props) {
  const { profile } = useAuth();
  const writer = canWrite(profile?.role);
  const admin = isAdmin(profile?.role);
  const [pastExpanded, setPastExpanded] = useState(false);

  const { upcoming, past, pastCount } = useMemo(() => {
    const up: CalendarEventWithRelations[] = [];
    const pa: CalendarEventWithRelations[] = [];
    for (const e of events) (classifyEventDate(e.starts_at) === 'past' ? pa : up).push(e);
    // Minione: najnowsze dni pierwsze, w obrębie dnia chronologicznie
    const pastGroups = groupByDay(pa.slice().reverse()).map((g) => ({ ...g, events: g.events.reverse() }));
    return { upcoming: groupByDay(up), past: pastGroups, pastCount: pa.length };
  }, [events]);

  if (isLoading) return <EventsListSkeleton />;

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CalendarX2 className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          {filtered ? 'Brak wydarzeń spełniających kryteria.' : 'Brak wydarzeń w kalendarzu.'}
        </p>
        {onAdd && !filtered && (
          <Button size="sm" onClick={onAdd}>
            <Plus />
            Dodaj wydarzenie
          </Button>
        )}
      </div>
    );
  }

  const rowActions: RowActions = { writer, admin, onEdit, onDelete };

  return (
    <div className="space-y-5">
      {upcoming.length === 0 && (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Brak nadchodzących wydarzeń.
        </p>
      )}
      {upcoming.map((g) => (
        <DaySection key={g.key} group={g} {...rowActions} />
      ))}

      {pastCount > 0 && (
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setPastExpanded((v) => !v)}
            className="flex h-10 items-center gap-2 rounded-lg pr-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={pastExpanded}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', !pastExpanded && '-rotate-90')} aria-hidden />
            {EVENT_GROUP_LABELS.past}
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{pastCount}</span>
          </button>
          {pastExpanded && (
            <div className="space-y-5">
              {past.map((g) => (
                <DaySection key={g.key} group={g} {...rowActions} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

type RowActions = Omit<ComponentProps<typeof EventRow>, 'event'>;

function DaySection({ group, ...rowActions }: RowActions & { group: DayGroup }) {
  const relative = relativeLabel(group.day);
  const today = isToday(group.day);
  const dateLabel = format(group.day, isSameYear(group.day, new Date()) ? 'EEEE, d MMMM' : 'EEEE, d MMMM yyyy', {
    locale: pl,
  });

  return (
    <section>
      <div className="sticky top-0 z-10 flex items-baseline gap-2 bg-background/95 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <h3 className={cn('text-sm font-semibold first-letter:uppercase', today && 'text-primary')}>
          {relative ?? dateLabel}
        </h3>
        {relative && <span className="text-xs text-muted-foreground">{dateLabel}</span>}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{group.events.length}</span>
      </div>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-sm">
        {group.events.map((e) => (
          <EventRow key={e.id} event={e} {...rowActions} />
        ))}
      </ul>
    </section>
  );
}

function EventsListSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Wczytywanie wydarzeń">
      {[3, 2].map((rows, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <div className="divide-y rounded-lg border bg-card">
            {Array.from({ length: rows }).map((_, j) => (
              <div key={j} className="flex h-12 items-center gap-3 px-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-2 w-2 rounded-full" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="hidden h-5 w-20 rounded-full @md:block" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

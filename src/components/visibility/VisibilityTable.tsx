import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, MapPinned } from 'lucide-react';
import { lastEventLabel, visibilityStatus } from '@/lib/visibility';
import type { PowiatVisibilityStats } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { VisibilityStatusPill } from '@/components/visibility/VisibilityStatusPill';
import { cn } from '@/lib/utils';

interface Props {
  stats: PowiatVisibilityStats[];
  isLoading: boolean;
  thresholdDays: number;
}

type SortKey = 'name' | 'contacts' | 'events' | 'days';
type SortDir = 'asc' | 'desc';

export function VisibilityTable({ stats, isLoading, thresholdDays }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('days');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    const arr = stats.slice();
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.powiat_name.localeCompare(b.powiat_name, 'pl');
          break;
        case 'contacts':
          cmp = a.contacts_count - b.contacts_count;
          break;
        case 'events':
          cmp = a.events_count - b.events_count;
          break;
        case 'days': {
          // null days_since (nigdy) = "infinity" - najpilniejsze
          const av = a.days_since_last_event ?? Number.POSITIVE_INFINITY;
          const bv = b.days_since_last_event ?? Number.POSITIVE_INFINITY;
          cmp = av - bv;
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [stats, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="border-b px-4 py-3">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex h-11 items-center gap-4 px-4">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="ml-auto h-3.5 w-10" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const SortBtn = ({ k, label, align = 'left' }: { k: SortKey; label: string; align?: 'left' | 'right' }) => {
    const active = sortKey === k;
    const Icon = sortDir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => toggleSort(k)}
        className={cn(
          'h-7 gap-1 px-1.5 text-xs font-medium text-muted-foreground hover:text-foreground',
          align === 'right' ? '-mr-1.5' : '-ml-1.5',
          active && 'text-foreground',
        )}
      >
        {label}
        {active && <Icon className="h-3 w-3" />}
      </Button>
    );
  };

  return (
    // Własny kontener: układ zależy od szerokości karty (obok mapy na szerokim ekranie, pełna szerokość w wąskim module).
    <section aria-label="Powiaty" className="overflow-hidden rounded-xl border bg-card shadow-sm @container/powiaty">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Powiaty</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {stats.length}
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MapPinned className="h-5 w-5" />
          </div>
          <p className="text-sm text-muted-foreground">Brak danych o powiatach.</p>
        </div>
      ) : (
        <>
          {/* Wąska karta (telefon): najważniejsze dane w zwartych wierszach, bez tabeli i kontrolek sortowania. */}
          <div className="divide-y @[36rem]/powiaty:hidden">
            {sorted.map((s) => {
              const status = visibilityStatus(s.days_since_last_event, thresholdDays);
              return (
                <article key={s.powiat_id} className="space-y-2.5 px-4 py-3">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <h3 className="min-w-0 break-words text-sm font-medium">{s.powiat_name}</h3>
                    <VisibilityStatusPill status={status} />
                  </div>
                  <dl className="grid grid-cols-3 gap-3 text-xs">
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Kontakty</dt>
                      <dd className="mt-0.5 font-medium tabular-nums">{s.contacts_count}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Wydarzenia</dt>
                      <dd className="mt-0.5 font-medium tabular-nums">{s.events_count}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Ostatnio</dt>
                      <dd className="mt-0.5 break-words font-medium">{lastEventLabel(s.last_event_at)}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto @[36rem]/powiaty:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr className="h-9 border-b">
                  <th className="px-4 font-medium"><SortBtn k="name" label="Powiat" /></th>
                  <th className="px-3 text-right font-medium"><SortBtn k="contacts" label="Kontakty" align="right" /></th>
                  <th className="px-3 text-right font-medium"><SortBtn k="events" label="Wydarzenia" align="right" /></th>
                  <th className="hidden px-3 text-xs font-medium text-muted-foreground @md/powiaty:table-cell">Ostatnia obecność</th>
                  <th className="px-3 font-medium"><SortBtn k="days" label="Dni od" /></th>
                  <th className="px-4 text-xs font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.map((s) => {
                  const status = visibilityStatus(s.days_since_last_event, thresholdDays);
                  return (
                    <tr key={s.powiat_id} className="h-11 transition-colors hover:bg-muted/60">
                      <td className="px-4 font-medium">{s.powiat_name}</td>
                      <td className="px-3 text-right tabular-nums">{s.contacts_count}</td>
                      <td className="px-3 text-right tabular-nums">{s.events_count}</td>
                      <td className="hidden px-3 text-[13px] text-muted-foreground @md/powiaty:table-cell">
                        {lastEventLabel(s.last_event_at)}
                      </td>
                      <td className="whitespace-nowrap px-3 text-[13px] tabular-nums text-muted-foreground">
                        {s.days_since_last_event === null
                          ? '-'
                          : `${s.days_since_last_event} ${s.days_since_last_event === 1 ? 'dzień' : 'dni'}`}
                      </td>
                      <td className="px-4"><VisibilityStatusPill status={status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

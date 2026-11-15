import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  isWeekend,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { pl } from 'date-fns/locale';
import { CalendarCheck, Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { InterpellationDeadline } from '@/components/interpellations/InterpellationDeadline';
import { deadlineState, type DeadlineState } from '@/lib/interpellations';
import { cn } from '@/lib/utils';
import type { InterpellationListItem } from '@/integrations/supabase/types';

interface Props {
  monthDate: Date;
  items: InterpellationListItem[];
  isLoading: boolean;
}

type EntryKind = 'deadline' | 'sent';

interface CalendarEntry {
  item: InterpellationListItem;
  kind: EntryKind;
  /** Termin wysłania (`deadline`) albo moment wysyłki (`sent`). */
  iso: string;
  at: Date;
}

const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const MAX_CHIPS = 3;
const MAX_DOTS = 4;

const DEADLINE_CHIP: Record<DeadlineState, string> = {
  overdue: 'bg-destructive text-destructive-foreground',
  soon: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  ok: 'bg-brand/10 text-brand',
};
const DEADLINE_DOT: Record<DeadlineState, string> = {
  overdue: 'bg-destructive ring-2 ring-destructive/30',
  soon: 'bg-amber-500',
  ok: 'bg-brand',
};
const SENT_CHIP = 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200';
const SENT_DOT = 'bg-emerald-500';

const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');

/** Terminy wysłania zaakceptowanych i daty faktycznej wysyłki; inne etapy nie mają dat w kalendarzu. */
function toEntries(items: InterpellationListItem[]): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  for (const item of items) {
    if (item.status === 'zaakceptowana' && item.deadline_at) {
      entries.push({ item, kind: 'deadline', iso: item.deadline_at, at: new Date(item.deadline_at) });
    } else if (item.status === 'wyslana' && item.sent_at) {
      entries.push({ item, kind: 'sent', iso: item.sent_at, at: new Date(item.sent_at) });
    }
  }
  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function entryColors(entry: CalendarEntry, now: Date): { chip: string; dot: string } {
  if (entry.kind === 'sent') return { chip: SENT_CHIP, dot: SENT_DOT };
  const state = deadlineState(entry.iso, now);
  return { chip: DEADLINE_CHIP[state], dot: DEADLINE_DOT[state] };
}

/** Siatka miesiąca z terminami wysłania i wysyłkami + lista wybranego dnia pod spodem. */
export function InterpellationsCalendar({ monthDate, items, isLoading }: Props) {
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const now = new Date();

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of toEntries(items)) {
      const key = dayKey(entry.at);
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    return map;
  }, [items]);

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(monthDate), { weekStartsOn: 1 }),
      }),
    [monthDate],
  );

  const selectedEntries = byDay.get(dayKey(selectedDay)) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {/* Próbki w kolorach chipów z siatki; same kropki brand i destructive są nie do odróżnienia. */}
        <LegendSwatch className={DEADLINE_CHIP.ok} label="Termin wysłania" />
        <LegendSwatch className={DEADLINE_CHIP.soon} label="Termin za mniej niż 6 h" />
        <LegendSwatch className={DEADLINE_CHIP.overdue} label="Po terminie" />
        <LegendSwatch className={SENT_CHIP} label="Wysłana" />
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const entries = byDay.get(dayKey(day)) ?? [];
            const inMonth = isSameMonth(day, monthDate);
            const today = isToday(day);
            const selected = isSameDay(day, selectedDay);
            const hidden = entries.length - MAX_CHIPS;
            return (
              // Kliknięcie w tło komórki to skrót myszą; z klawiatury dzień wybiera przycisk z numerem.
              <div
                key={day.toISOString()}
                onClick={() => setSelectedDay(day)}
                className={cn(
                  'flex min-h-[64px] cursor-pointer flex-col gap-1 border-b border-r p-1 transition-colors hover:bg-muted/60 @md:min-h-[104px] @md:p-1.5',
                  isWeekend(day) && 'bg-muted/30',
                  !inMonth && 'bg-muted/40',
                  selected && 'bg-primary/5 ring-1 ring-inset ring-primary/40',
                  i % 7 === 6 && 'border-r-0',
                  i >= days.length - 7 && 'border-b-0',
                )}
              >
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSelectedDay(day);
                  }}
                  aria-pressed={selected}
                  aria-label={`${format(day, 'EEEE, d MMMM', { locale: pl })}: ${entries.length} interpelacji`}
                  aria-current={today ? 'date' : undefined}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium tabular-nums transition-colors',
                    today
                      ? 'bg-primary text-primary-foreground'
                      : cn('hover:bg-muted', !inMonth && 'text-muted-foreground/60'),
                  )}
                >
                  {format(day, 'd')}
                </button>

                {isLoading && inMonth && i % 4 === 0 && (
                  <Skeleton className="hidden h-5 w-4/5 rounded-full @md:block" />
                )}

                {/* Wąski obszar modułu: kropki */}
                {entries.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-0.5 @md:hidden" aria-hidden>
                    {entries.slice(0, MAX_DOTS).map((e) => (
                      <span key={`${e.kind}-${e.item.id}`} className={cn('h-1.5 w-1.5 rounded-full', entryColors(e, now).dot)} />
                    ))}
                  </div>
                )}

                {/* Szeroki obszar modułu: chipy z tematem */}
                <div className="hidden min-w-0 flex-col gap-0.5 @md:flex">
                  {entries.slice(0, MAX_CHIPS).map((e) => (
                    <Link
                      key={`${e.kind}-${e.item.id}`}
                      to={`/biuro/interpelacje/${e.item.id}`}
                      onClick={(ev) => ev.stopPropagation()}
                      title={`${e.kind === 'sent' ? 'Wysłana' : 'Termin wysłania'}: ${e.item.subject}`}
                      className={cn(
                        'flex h-5 w-full min-w-0 items-center gap-1 rounded-full px-1.5 text-[11px] leading-none transition-opacity hover:opacity-80',
                        entryColors(e, now).chip,
                      )}
                    >
                      <span className="shrink-0 tabular-nums opacity-70">{format(e.at, 'HH:mm')}</span>
                      <span className="truncate font-medium">{e.item.subject}</span>
                    </Link>
                  ))}
                  {hidden > 0 && (
                    <span className="self-start px-1.5 text-[11px] font-medium text-muted-foreground">
                      +{hidden} więcej
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <section aria-live="polite" className="rounded-xl border bg-card shadow-sm">
        <h2 className="border-b px-4 py-2.5 text-sm font-semibold first-letter:uppercase">
          {format(selectedDay, 'EEEE, d MMMM yyyy', { locale: pl })}
        </h2>
        {selectedEntries.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Brak terminów wysłania i wysyłek tego dnia.
          </p>
        ) : (
          <ul>
            {selectedEntries.map((e) => (
              <li
                key={`${e.kind}-${e.item.id}`}
                className="relative flex items-start gap-3 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/60"
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    entryColors(e, now).chip,
                  )}
                  aria-hidden
                >
                  {e.kind === 'sent' ? <CalendarCheck className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/biuro/interpelacje/${e.item.id}`}
                    className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
                  >
                    {e.item.subject}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="truncate">Odbiorca: {e.item.recipient}</span>
                    {e.kind === 'sent' ? (
                      <span>wysłano o {format(e.at, 'HH:mm')}</span>
                    ) : (
                      <InterpellationDeadline deadlineAt={e.iso} />
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-3 w-5 rounded-full ring-1 ring-inset ring-foreground/10', className)} aria-hidden />
      {label}
    </span>
  );
}

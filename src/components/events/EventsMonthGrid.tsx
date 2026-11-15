import { useMemo } from 'react';
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  isWeekend,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { pl } from 'date-fns/locale';
import { Plus } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EVENT_TYPE_DOT, EVENT_TYPE_PILL, eventOnDay } from '@/lib/events';
import type { CalendarEventWithRelations } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import { pluralizeEvents } from './eventFormat';

interface Props {
  monthDate: Date;
  events: CalendarEventWithRelations[];
  isLoading: boolean;
  onSelectDay: (day: Date) => void;
  onSelectEvent: (e: CalendarEventWithRelations) => void;
  /** Podane tylko dla użytkowników z prawem zapisu. */
  onAddDay?: (day: Date) => void;
}

const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const MAX_CHIPS = 3;
const MAX_DOTS = 4;

export function EventsMonthGrid({ monthDate, events, isLoading, onSelectDay, onSelectEvent, onAddDay }: Props) {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(monthDate), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end }).map((day) => ({
      day,
      events: events.filter((e) => eventOnDay(e.starts_at, e.ends_at, day)),
    }));
  }, [monthDate, events]);

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map(({ day, events: dayEvents }, i) => {
          const inMonth = isSameMonth(day, monthDate);
          const today = isToday(day);
          const hidden = dayEvents.length - MAX_CHIPS;
          return (
            // Kliknięcie w tło komórki to skrót myszą; z klawiatury dzień otwiera przycisk z numerem.
            <div
              key={day.toISOString()}
              onClick={() => onSelectDay(day)}
              className={cn(
                'group/cell flex min-h-[72px] cursor-pointer flex-col gap-1 border-b border-r p-1 transition-colors hover:bg-muted/60 @md:min-h-[112px] @md:p-1.5',
                // Weekend w miesiącu - delikatne tło; dni spoza miesiąca wyraźniej przygaszone.
                inMonth ? isWeekend(day) && 'bg-muted/20' : 'bg-muted/50',
                i % 7 === 6 && 'border-r-0',
                i >= days.length - 7 && 'border-b-0',
              )}
            >
              {/* Wąski obszar modułu: numer dnia wyśrodkowany nad kropkami typów. */}
              <div className="flex items-center justify-between @max-md:justify-center">
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onSelectDay(day);
                  }}
                  aria-label={`${format(day, 'EEEE, d MMMM', { locale: pl })}: ${pluralizeEvents(dayEvents.length)}`}
                  aria-current={today ? 'date' : undefined}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium tabular-nums transition-colors max-md:h-10 max-md:w-full max-md:max-w-10',
                    today
                      ? 'bg-primary text-primary-foreground'
                      : cn('hover:bg-muted', !inMonth && 'text-muted-foreground/60'),
                  )}
                >
                  {format(day, 'd')}
                </button>
                {onAddDay && (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onAddDay(day);
                    }}
                    aria-label={`Dodaj wydarzenie: ${format(day, 'd MMMM', { locale: pl })}`}
                    className="hidden h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/cell:opacity-100 @md:flex"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {isLoading && inMonth && i % 3 === 0 && <Skeleton className="hidden h-5 w-4/5 rounded-full @md:block" />}

              {/* Wąski obszar modułu (telefon, panel PoliAI): tylko kropki typów */}
              {dayEvents.length > 0 && (
                <div className="flex flex-wrap justify-center gap-0.5 @md:hidden" aria-hidden>
                  {dayEvents.slice(0, MAX_DOTS).map((e) => (
                    <span key={e.id} className={cn('h-1.5 w-1.5 rounded-full', EVENT_TYPE_DOT[e.type])} />
                  ))}
                </div>
              )}

              {/* Szeroki obszar modułu: chipy wydarzeń */}
              <div className="hidden min-w-0 flex-col gap-0.5 @md:flex">
                {dayEvents.slice(0, MAX_CHIPS).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onSelectEvent(e);
                    }}
                    title={e.title}
                    className={cn(
                      'flex h-5 w-full min-w-0 items-center gap-1 rounded-full px-1.5 text-left text-[11px] leading-none transition-opacity hover:opacity-80',
                      EVENT_TYPE_PILL[e.type],
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', EVENT_TYPE_DOT[e.type])} aria-hidden />
                    {!e.all_day && (
                      <span className="shrink-0 tabular-nums opacity-70">
                        {format(new Date(e.starts_at), 'HH:mm', { locale: pl })}
                      </span>
                    )}
                    <span className="truncate font-medium">{e.title}</span>
                  </button>
                ))}
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onSelectDay(day);
                    }}
                    className="self-start rounded-full px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    +{hidden} więcej
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

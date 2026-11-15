import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { pl } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { publicFocus } from '@/components/public/styles';
import { dayKey, plural } from '@/components/public/publicFormat';

const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];

interface Props {
  month: Date;
  onMonthChange: (month: Date) => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Liczba wydarzeń biura w danym dniu (klucz `yyyy-MM-dd`). */
  eventCounts: ReadonlyMap<string, number>;
  /** Dni posiedzeń Sejmu (klucz `yyyy-MM-dd`). */
  sejmByDay: ReadonlyMap<string, unknown>;
  className?: string;
}

/** Siatka miesiąca: dzisiejszy dzień wyróżniony, dni posiedzeń Sejmu i wydarzenia biura oznaczone. */
export function PublicMonthGrid({ month, onMonthChange, selectedKey, onSelect, eventCounts, sejmByDay, className }: Props) {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });
  const monthLabel = format(month, 'LLLL yyyy', { locale: pl });
  const isCurrentMonth = isSameMonth(month, new Date());

  const navBtn = cn(
    'inline-flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-cream-2',
    publicFocus,
  );

  return (
    <div className={cn('rounded-[var(--public-radius-card)] border border-border bg-card p-3 sm:p-5', className)}>
      <div className="flex items-center justify-between gap-2 pl-1">
        <h3 className="text-lg font-bold capitalize" aria-live="polite">
          {monthLabel}
        </h3>
        <div className="flex items-center gap-1">
          {!isCurrentMonth && (
            <button
              type="button"
              onClick={() => onMonthChange(startOfMonth(new Date()))}
              className={cn(
                'mr-1 inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-brand transition-colors hover:bg-cream-2',
                publicFocus,
              )}
            >
              Dziś
            </button>
          )}
          <button type="button" onClick={() => onMonthChange(addMonths(month, -1))} className={navBtn} aria-label="Poprzedni miesiąc">
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <button type="button" onClick={() => onMonthChange(addMonths(month, 1))} className={navBtn} aria-label="Następny miesiąc">
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center" aria-hidden>
        {WEEKDAYS.map((d, i) => (
          <span
            key={d}
            className={cn('py-1 text-[11px] font-bold uppercase tracking-[0.08em]', i >= 5 ? 'text-brand/70' : 'text-muted-foreground')}
          >
            {d}
          </span>
        ))}
      </div>

      <div role="group" aria-label={`Dni: ${monthLabel}`} className="mt-1 grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = dayKey(day);
          const inMonth = isSameMonth(day, month);
          const today = isToday(day);
          const sejm = sejmByDay.has(key);
          const events = eventCounts.get(key) ?? 0;
          const selected = selectedKey === key;

          const notes = [
            today && 'dziś',
            sejm && 'posiedzenie Sejmu',
            events > 0 && `${events} ${plural(events, 'wydarzenie', 'wydarzenia', 'wydarzeń')} biura`,
          ].filter(Boolean);

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              aria-pressed={selected}
              aria-label={`${format(day, 'EEEE, d MMMM', { locale: pl })}${notes.length ? ` - ${notes.join(', ')}` : ''}`}
              className={cn(
                'relative flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-sm tabular-nums transition-colors sm:min-h-14',
                sejm ? 'bg-foreground/[0.08] hover:bg-foreground/[0.14]' : 'hover:bg-cream-2',
                !inMonth && 'opacity-40',
                selected && 'ring-2 ring-inset ring-foreground',
                publicFocus,
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full',
                  today ? 'bg-brand font-bold text-brand-foreground' : 'font-medium text-foreground',
                )}
              >
                {format(day, 'd')}
              </span>
              <span className="flex h-1.5 items-center gap-1" aria-hidden>
                {sejm && <span className="h-1.5 w-3 rounded-full bg-foreground" />}
                {events > 0 && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
              </span>
            </button>
          );
        })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border px-1 pt-3 text-[13px] text-muted-foreground">
        <li className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-brand" aria-hidden />
          Dziś
        </li>
        <li className="inline-flex items-center gap-2">
          <span className="h-1.5 w-3 rounded-full bg-foreground" aria-hidden />
          Posiedzenie Sejmu
        </li>
        <li className="inline-flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
          Wydarzenie biura
        </li>
      </ul>
    </div>
  );
}

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { pl } from 'date-fns/locale';

import { cn } from '@/lib/utils';

const WEEKDAYS = ['pn', 'wt', 'śr', 'cz', 'pt', 'so', 'nd'];

interface Props {
  /** ISO date string YYYY-MM-DD or null. */
  value?: string | null;
  onChange: (date: string) => void;
  onClear?: () => void;
}

export function MiniCalendar({ value, onChange, onClear }: Props) {
  const initialDate = value ? new Date(value) : new Date();
  const [viewMonth, setViewMonth] = useState(startOfMonth(initialDate));
  const selected = value ? new Date(value) : null;

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div className="w-[260px] p-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setViewMonth((m) => subMonths(m, 1))}
          aria-label="Poprzedni miesiąc"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold capitalize">
          {format(viewMonth, 'LLLL yyyy', { locale: pl })}
        </p>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
          aria-label="Następny miesiąc"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="py-1 text-center text-[11px] font-medium text-muted-foreground"
          >
            {w}
          </div>
        ))}
        {days.map((d) => {
          const inMonth = isSameMonth(d, viewMonth);
          const isSelected = selected ? isSameDay(d, selected) : false;
          const today = isToday(d);
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onChange(format(d, 'yyyy-MM-dd'))}
              className={cn(
                'h-8 rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                !inMonth && 'text-muted-foreground/40',
                !isSelected && 'hover:bg-accent',
                isSelected && 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
                today && !isSelected && 'font-semibold text-primary ring-1 ring-inset ring-primary/50',
              )}
            >
              {format(d, 'd')}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between border-t pt-2">
        {onClear ? (
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
            onClick={onClear}
          >
            Wyczyść
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
          onClick={() => onChange(format(new Date(), 'yyyy-MM-dd'))}
        >
          Dziś
        </button>
      </div>
    </div>
  );
}

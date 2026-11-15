import { addMonths, format, subMonths } from 'date-fns';
import { pl } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight, List, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type CalendarView = 'list' | 'month';

const VIEWS: { value: CalendarView; label: string; icon: LucideIcon }[] = [
  { value: 'list', label: 'Lista', icon: List },
  { value: 'month', label: 'Miesiąc', icon: CalendarDays },
];

interface ViewTabsProps {
  value: CalendarView;
  onChange: (view: CalendarView) => void;
}

/** Zakładki widoków w stylu ClickUp (Lista / Miesiąc). */
export function CalendarViewTabs({ value, onChange }: ViewTabsProps) {
  return (
    <div role="tablist" aria-label="Widok kalendarza" className="flex items-center gap-2 md:gap-1">
      {VIEWS.map(({ value: v, label, icon: Icon }) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(v)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors max-md:h-10 max-md:px-3.5',
              active
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

interface MonthNavProps {
  monthDate: Date;
  onChange: (next: Date) => void;
}

/** Kompaktowa nawigacja miesiąca: ‹ Dziś › + etykieta. */
export function MonthNav({ monthDate, onChange }: MonthNavProps) {
  return (
    <div className="flex items-center gap-2 @max-md:w-full md:gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        onClick={() => onChange(subMonths(monthDate, 1))}
        aria-label="Poprzedni miesiąc"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-9"
        onClick={() => onChange(new Date())}
      >
        Dziś
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        onClick={() => onChange(addMonths(monthDate, 1))}
        aria-label="Następny miesiąc"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <span
        className="ml-1 inline-block min-w-[8.5rem] text-sm font-semibold tabular-nums first-letter:uppercase @max-md:ml-auto @max-md:min-w-0 @max-md:text-right"
        aria-live="polite"
      >
        {format(monthDate, 'LLLL yyyy', { locale: pl })}
      </span>
    </div>
  );
}

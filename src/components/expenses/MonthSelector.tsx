import { useRef } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { currentMonthIso, formatMonthLabel, shiftMonth } from '@/lib/expenses';

interface Props {
  value: string; // 'YYYY-MM'
  onChange: (yearMonth: string) => void;
}

// Poniżej md wysokość/szerokość daje Button (44px); md+ jak dawniej 32px.
const STEP_BUTTON = 'rounded-full md:h-8 md:w-8';

export function MonthSelector({ value, onChange }: Props) {
  const today = currentMonthIso();
  const isCurrent = value === today;
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const input = inputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      // Brak wsparcia `showPicker` dla type="month" (np. Firefox) - fokus pozwala wpisać miesiąc.
      input.focus();
    }
  };

  return (
    // Wąski moduł: pigułka wypełnia wiersz pod zakładkami (strzałki przy krawędziach), zamiast kończyć się w połowie.
    <div className="flex flex-wrap items-center gap-2 @max-md:w-full">
      <div className="inline-flex items-center rounded-full border bg-card p-0.5 shadow-card @max-md:grow @max-md:justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={STEP_BUTTON}
          aria-label="Poprzedni miesiąc"
          onClick={() => onChange(shiftMonth(value, -1))}
        >
          <ChevronLeft />
        </Button>

        <div className="relative @max-md:min-w-0 @max-md:flex-1">
          <button
            type="button"
            onClick={openPicker}
            className="inline-flex h-11 min-w-[9.5rem] items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-medium capitalize transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 md:h-8 @max-md:w-full @max-md:min-w-0"
            aria-label={`Wybrany miesiąc: ${formatMonthLabel(value)}. Zmień miesiąc`}
          >
            <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
            {formatMonthLabel(value)}
          </button>
          <input
            ref={inputRef}
            type="month"
            value={value}
            onChange={(e) => {
              if (e.target.value) onChange(e.target.value);
            }}
            max={today}
            tabIndex={-1}
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0 focus:pointer-events-auto focus:rounded-full focus:border focus:bg-card focus:px-3 focus:text-sm focus:opacity-100"
            aria-label="Wybierz miesiąc"
          />
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={STEP_BUTTON}
          aria-label="Następny miesiąc"
          onClick={() => onChange(shiftMonth(value, 1))}
          disabled={isCurrent}
        >
          <ChevronRight />
        </Button>
      </div>

      {!isCurrent && (
        <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => onChange(today)}>
          Bieżący miesiąc
        </Button>
      )}
    </div>
  );
}

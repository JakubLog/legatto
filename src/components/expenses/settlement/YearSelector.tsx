import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  value: number;
  onChange: (year: number) => void;
  /** Najpóźniejszy dostępny rok (bieżący). */
  max: number;
}

// Poniżej md wysokość/szerokość daje Button (44px); md+ 32px - jak w MonthSelector.
const STEP_BUTTON = 'rounded-full md:h-8 md:w-8';

/** Wybór roku rozliczenia: poprzedni/następny + szybki powrót do bieżącego. */
export function YearSelector({ value, onChange, max }: Props) {
  const isCurrent = value === max;
  return (
    // Wąski moduł: pigułka wypełnia wiersz jak MonthSelector.
    <div className="flex flex-wrap items-center gap-2 @max-md:w-full">
      <div className="inline-flex items-center rounded-full border bg-card p-0.5 shadow-card @max-md:grow @max-md:justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={STEP_BUTTON}
          aria-label="Poprzedni rok"
          onClick={() => onChange(value - 1)}
          disabled={value <= 2000}
        >
          <ChevronLeft />
        </Button>
        <span
          className="inline-flex h-11 min-w-[7rem] items-center justify-center gap-1.5 px-3 text-sm font-medium tabular-nums md:h-8 @max-md:min-w-0 @max-md:flex-1"
          aria-live="polite"
        >
          <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden />
          Rok {value}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={STEP_BUTTON}
          aria-label="Następny rok"
          onClick={() => onChange(value + 1)}
          disabled={isCurrent}
        >
          <ChevronRight />
        </Button>
      </div>
      {!isCurrent && (
        <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => onChange(max)}>
          Bieżący rok
        </Button>
      )}
    </div>
  );
}

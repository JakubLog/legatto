import { CalendarDays, Columns3, List, type LucideIcon } from 'lucide-react';
import type { InterpellationsLayout } from '@/lib/interpellations';
import { cn } from '@/lib/utils';

const VIEWS: { value: InterpellationsLayout; label: string; icon: LucideIcon }[] = [
  { value: 'list', label: 'Lista', icon: List },
  { value: 'board', label: 'Tablica', icon: Columns3 },
  { value: 'calendar', label: 'Kalendarz', icon: CalendarDays },
];

interface Props {
  value: InterpellationsLayout;
  onChange: (next: InterpellationsLayout) => void;
}

/**
 * Zakładki widoków interpelacji w stylu ClickUp (Lista / Tablica / Kalendarz).
 * Na telefonie ukryte: strona zawsze pokazuje listę (tablica i kalendarz tylko na desktopie).
 */
export function InterpellationViewTabs({ value, onChange }: Props) {
  return (
    <div role="tablist" aria-label="Widok interpelacji" className="flex items-center gap-1 @max-md:hidden">
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
              'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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

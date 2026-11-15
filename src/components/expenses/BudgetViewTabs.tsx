import { ChartColumn, ClipboardCheck, Receipt, Sparkles, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BudgetView = 'wydatki' | 'analityka' | 'raporty' | 'rozliczenie';

const TABS: { value: BudgetView; label: string; shortLabel?: string; icon: LucideIcon }[] = [
  { value: 'wydatki', label: 'Wydatki', icon: Receipt },
  { value: 'analityka', label: 'Analityka', icon: ChartColumn },
  { value: 'raporty', label: 'Raporty AI', icon: Sparkles },
  { value: 'rozliczenie', label: 'Podsumowanie i rozliczenie', shortLabel: 'Rozliczenie', icon: ClipboardCheck },
];

interface Props {
  value: BudgetView;
  onChange: (next: BudgetView) => void;
}

/**
 * Zakładki widoków budżetu w stylu ClickUp (ikona + etykieta, aktywna wyróżniona).
 * Telefon (poniżej @sm): siatka 2×2 - wszystkie widoki widoczne, bez osieroconej zakładki w drugim wierszu.
 * Wąski moduł (poniżej @md): krótka etykieta "Rozliczenie", żeby zakładki zmieściły się w jednym wierszu.
 */
export function BudgetViewTabs({ value, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Widok budżetu"
      className="flex items-center gap-1 @max-sm:grid @max-sm:w-full @max-sm:grid-cols-2"
    >
      {TABS.map(({ value: tab, label, shortLabel, icon: Icon }) => {
        const active = tab === value;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab)}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-md:h-11',
              active
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {shortLabel ? (
              <>
                <span className="@max-md:hidden">{label}</span>
                <span className="@md:hidden">{shortLabel}</span>
              </>
            ) : (
              label
            )}
          </button>
        );
      })}
    </div>
  );
}

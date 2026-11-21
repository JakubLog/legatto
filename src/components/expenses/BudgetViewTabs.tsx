import { ChartColumn, ClipboardCheck, Receipt, Sparkles, type LucideIcon } from 'lucide-react';
import { INSTANCE } from '@/lib/instance';
import { cn } from '@/lib/utils';

export type BudgetView = 'wydatki' | 'analityka' | 'raporty' | 'rozliczenie';

const ALL_TABS: { value: BudgetView; label: string; shortLabel?: string; icon: LucideIcon }[] = [
  { value: 'wydatki', label: 'Wydatki', icon: Receipt },
  { value: 'analityka', label: 'Analityka', icon: ChartColumn },
  { value: 'raporty', label: 'Raporty AI', icon: Sparkles },
  { value: 'rozliczenie', label: 'Podsumowanie i rozliczenie', shortLabel: 'Rozliczenie', icon: ClipboardCheck },
];

// Raporty AI tylko z włączonym AI na instancji (INSTANCE_AI=on).
const TABS = INSTANCE.ai ? ALL_TABS : ALL_TABS.filter((t) => t.value !== 'raporty');

/** Widok z parametru `?widok=`; nieznany albo niedostępny na instancji - Wydatki. */
export function parseBudgetView(param: string | null): BudgetView {
  return TABS.find((t) => t.value === param)?.value ?? 'wydatki';
}

interface Props {
  value: BudgetView;
  onChange: (next: BudgetView) => void;
}

/**
 * Zakładki widoków budżetu w stylu ClickUp (ikona + etykieta, aktywna wyróżniona).
 * Telefon (poniżej @sm): siatka po dwie - wszystkie widoki widoczne; przy nieparzystej liczbie
 * zakładek (bez raportów AI) ostatnia zajmuje cały wiersz zamiast zostać osierocona.
 * Wąski moduł (poniżej @md): krótka etykieta "Rozliczenie", żeby zakładki zmieściły się w jednym wierszu.
 */
export function BudgetViewTabs({ value, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Widok budżetu"
      className="flex items-center gap-1 @max-sm:grid @max-sm:w-full @max-sm:grid-cols-2"
    >
      {TABS.map(({ value: tab, label, shortLabel, icon: Icon }, index) => {
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
              TABS.length % 2 === 1 && index === TABS.length - 1 && '@max-sm:col-span-2 @max-sm:justify-center',
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

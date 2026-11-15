import { History } from 'lucide-react';
import type { BudgetReportWithCreator } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import { formatReportDate, reportAuthor } from './reportUtils';

interface Props {
  reports: BudgetReportWithCreator[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/** Wszystkie raporty miesiąca (najnowszy pierwszy) - przełączanie wyświetlanej wersji. */
export function BudgetReportHistory({ reports, selectedId, onSelect }: Props) {
  return (
    <nav aria-label="Raporty z tego miesiąca" className="rounded-xl border bg-card shadow-card">
      <h3 className="flex items-center gap-2 border-b px-3 py-2.5 text-[13px] font-semibold">
        <History className="h-4 w-4 text-primary" aria-hidden />
        Raporty z tego miesiąca
        <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">{reports.length}</span>
      </h3>
      <ul className="max-h-48 divide-y overflow-y-auto @lg:max-h-[32rem]">
        {reports.map((r, i) => {
          const selected = r.id === selectedId;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r.id)}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none',
                  selected && 'bg-primary/5 hover:bg-primary/10',
                )}
              >
                <span className={cn('text-[13px] font-medium tabular-nums', selected && 'text-primary')}>
                  {formatReportDate(r.created_at, "d MMM yyyy', 'HH:mm")}
                  {i === 0 && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">najnowszy</span>}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {reportAuthor(r)} · <span className="font-mono text-[11px]">{r.model}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

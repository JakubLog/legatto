import { useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { pl } from 'date-fns/locale';
import { ChevronRight, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DashboardInterpellation } from '@/hooks/useDashboardStats';
import { DashboardSection, SectionEmpty, SectionRowsSkeleton } from '@/components/dashboard/DashboardSection';
import { InterpellationDeadline } from '@/components/interpellations/InterpellationDeadline';
import { InterpellationStatusPill } from '@/components/interpellations/InterpellationStatusPill';
import { sortByUrgency } from '@/components/interpellations/urgency';

const EMPTY_ITEMS: DashboardInterpellation[] = [];

interface Props {
  items?: DashboardInterpellation[];
  loading: boolean;
  className?: string;
}

/** Najpilniejsze aktywne interpelacje: termin wysłania, decyzja Posła, potem poprawki. */
export function InterpellationsCard({ items = EMPTY_ITEMS, loading, className }: Props) {
  const urgent = useMemo(() => sortByUrgency(items).slice(0, 6), [items]);
  return (
    <DashboardSection
      title="Interpelacje w toku"
      icon={FileText}
      to="/biuro/interpelacje"
      count={items.length}
      className={className}
    >
      {loading ? (
        <SectionRowsSkeleton rows={4} />
      ) : urgent.length === 0 ? (
        <SectionEmpty icon={FileText} message="Brak interpelacji w toku" />
      ) : (
        <ul className="divide-y">
          {urgent.map((item) => {
            const when =
              item.status === 'zaakceptowana' && item.deadline_at ? (
                <InterpellationDeadline deadlineAt={item.deadline_at} />
              ) : (
                <span>wgrano {formatDistanceToNow(new Date(item.submitted_at), { addSuffix: true, locale: pl })}</span>
              );
            return (
              <li key={item.id}>
                <Link
                  to={`/biuro/interpelacje/${item.id}`}
                  className="group flex min-h-14 min-w-0 max-w-full items-center gap-3 overflow-hidden px-4 py-2.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    {/* Telefon: status i termin w jednym wierszu, temat pod spodem (bez wiszącej kropki przy zawijaniu). */}
                    <div className="flex min-w-0 items-center gap-2 max-md:flex-wrap max-md:gap-y-1">
                      <InterpellationStatusPill status={item.status} />
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground md:hidden">{when}</span>
                      <p className="max-w-full truncate text-sm font-medium max-md:line-clamp-2 max-md:basis-full max-md:whitespace-normal">{item.subject}</p>
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-xs text-muted-foreground">
                      <span className="truncate">Odbiorca: {item.recipient}</span>
                      <span aria-hidden className="max-md:hidden">·</span>
                      <span className="shrink-0 max-md:hidden">{when}</span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 max-md:hidden" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardSection>
  );
}

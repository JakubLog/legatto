import { useMemo, useState, type ReactNode } from 'react';
import { Briefcase, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { CASE_STATUSES } from '@/lib/cases';
import type { CasesFilters } from '@/hooks/useCases';
import type { CaseStatus, CaseWithRelations } from '@/integrations/supabase/types';
import { isAdmin } from '@/lib/permissions';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { CaseStatusPill } from './CaseBadges';
import { CaseRow } from './CaseRow';
import { CasesColumnsHeader, type CasesSort } from './CasesColumnsHeader';

interface Props {
  cases: CaseWithRelations[];
  isLoading: boolean;
  /** Grupowanie (po stronie klienta) wczytanej listy według statusu. */
  groupByStatus?: boolean;
  filters: CasesFilters;
  onFiltersChange: (next: CasesFilters) => void;
  sort: CasesSort;
  onSortChange: (next: CasesSort) => void;
  emptyMessage: string;
  emptyAction?: ReactNode;
  onPreview: (c: CaseWithRelations) => void;
  onDelete: (c: CaseWithRelations) => void;
}

const collator = new Intl.Collator('pl', { sensitivity: 'base', numeric: true });

function sortCases(cases: CaseWithRelations[], sort: CasesSort): CaseWithRelations[] {
  if (sort === 'created') return cases;
  if (sort === 'title') return [...cases].sort((a, b) => collator.compare(a.title, b.title));
  // Termin: sprawy bez terminu zawsze na końcu, niezależnie od kierunku.
  const dir = sort === 'due_asc' ? 1 : -1;
  return [...cases].sort((a, b) => {
    if (!a.due_date || !b.due_date) return a.due_date ? -1 : b.due_date ? 1 : 0;
    return a.due_date.localeCompare(b.due_date) * dir;
  });
}

export function CasesList({
  cases,
  isLoading,
  groupByStatus = false,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  emptyMessage,
  emptyAction,
  onPreview,
  onDelete,
}: Props) {
  const { profile } = useAuth();
  const admin = isAdmin(profile?.role);
  const [collapsed, setCollapsed] = useState<ReadonlySet<CaseStatus>>(() => new Set());

  const sorted = useMemo(() => sortCases(cases, sort), [cases, sort]);
  const groups = useMemo(
    () =>
      CASE_STATUSES.map((status) => ({
        status,
        items: sorted.filter((c) => c.status === status),
      })).filter((g) => g.items.length > 0),
    [sorted],
  );

  const toggleGroup = (status: CaseStatus) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const header = (
    <CasesColumnsHeader filters={filters} onFiltersChange={onFiltersChange} sort={sort} onSortChange={onSortChange} />
  );

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {header}
        <div className="divide-y">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3 @md:h-11 @md:py-0">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="hidden h-4 w-24 @md:block" />
              <Skeleton className="hidden h-6 w-6 rounded-full @md:block" />
              <Skeleton className="hidden h-4 w-14 @md:block" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* Nagłówek zostaje przy pustym wyniku - filtr kolumny da się zmienić bez szukania pigułek. */}
        {header}
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Briefcase className="h-5 w-5" />
          </div>
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          {emptyAction}
        </div>
      </div>
    );
  }

  const renderRows = (items: CaseWithRelations[]) => (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {header}
      <ul className="divide-y">
        {items.map((c) => (
          <CaseRow key={c.id} case_={c} canDelete={admin} onPreview={onPreview} onDelete={onDelete} />
        ))}
      </ul>
    </div>
  );

  if (!groupByStatus) return renderRows(sorted);

  return (
    <div className="space-y-4">
      {groups.map(({ status, items }) => {
        const open = !collapsed.has(status);
        return (
          <section key={status} className="space-y-2">
            <button
              type="button"
              onClick={() => toggleGroup(status)}
              aria-expanded={open}
              className="flex h-10 items-center gap-2 rounded-lg pr-2 text-sm transition-colors hover:bg-muted/60"
            >
              <ChevronRight
                className={cn(
                  'h-4 w-4 text-muted-foreground transition-transform',
                  open && 'rotate-90',
                )}
              />
              <CaseStatusPill status={status} />
              <span className="text-xs text-muted-foreground">{items.length}</span>
            </button>
            {open && renderRows(items)}
          </section>
        );
      })}
    </div>
  );
}

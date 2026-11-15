import { Briefcase, ChevronRight, Flag, FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { RecentCase } from '@/hooks/useDashboardStats';
import {
  CASE_PRIORITY_CLASSNAME,
  CASE_PRIORITY_FLAG,
  CASE_PRIORITY_LABELS,
  CASE_STATUS_DOT,
  CASE_STATUS_LABELS,
} from '@/lib/cases';
import { cn } from '@/lib/utils';
import { DashboardSection, SectionEmpty, SectionRowsSkeleton } from '@/components/dashboard/DashboardSection';

interface RecentCasesCardProps {
  cases: RecentCase[];
  loading: boolean;
  className?: string;
}

/** Sekcja "Ostatnie sprawy": wiersz z kropką statusu, tytułem, kategorią i priorytetem. */
export function RecentCasesCard({ cases, loading, className }: RecentCasesCardProps) {
  return (
    <DashboardSection title="Ostatnie sprawy" icon={Briefcase} to="/biuro/sprawy" className={className}>
      {loading ? (
        <SectionRowsSkeleton rows={4} />
      ) : cases.length === 0 ? (
        <SectionEmpty
          icon={FolderOpen}
          message="Brak spraw."
          actionLabel="Przejdź do spraw"
          actionTo="/biuro/sprawy"
        />
      ) : (
        <ul className="divide-y">
          {cases.map((c) => (
            <li key={c.id}>
              <Link
                to={`/biuro/sprawy?open=${c.id}`}
                className="group flex min-h-12 min-w-0 max-w-full items-center gap-3 overflow-hidden px-4 py-2.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
              >
                <span
                  aria-hidden
                  className={cn('h-2 w-2 shrink-0 rounded-full', CASE_STATUS_DOT[c.status])}
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm font-medium">{c.title}</p>
                  <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="shrink-0">{CASE_STATUS_LABELS[c.status]}</span>
                    {c.category && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="truncate">{c.category.name}</span>
                      </>
                    )}
                  </p>
                </div>
                {c.priority !== 'normal' && (
                  <span
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs max-md:hidden',
                      CASE_PRIORITY_CLASSNAME[c.priority],
                    )}
                  >
                    <Flag aria-hidden className={cn('h-3 w-3', CASE_PRIORITY_FLAG[c.priority])} />
                    {CASE_PRIORITY_LABELS[c.priority]}
                  </span>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 max-md:hidden" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardSection>
  );
}

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface DashboardSectionProps {
  title: string;
  icon: LucideIcon;
  /** Link "Wszystkie" w nagłówku karty (ten sam wygląd i treść we wszystkich kartach). */
  to?: string;
  /** Licznik obok tytułu. */
  count?: number;
  children: ReactNode;
  className?: string;
}

/** Karta sekcji pulpitu: nagłówek z ikoną, licznik, link do modułu, lista wierszy. */
export function DashboardSection({
  title,
  icon: Icon,
  to,
  count,
  children,
  className,
}: DashboardSectionProps) {
  return (
    <section className={cn('flex min-w-0 max-w-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-card', className)}>
      <header className="flex h-12 min-w-0 items-center justify-between gap-2 border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {count !== undefined && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </div>
        {to && (
          <Link
            to={to}
            className="-mr-1 inline-flex h-10 shrink-0 items-center gap-0.5 rounded-md px-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11 max-md:text-sm"
          >
            Wszystkie
            <span className="sr-only">: {title}</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </header>
      <div className="min-w-0 max-w-full overflow-hidden flex-1">{children}</div>
    </section>
  );
}

interface SectionEmptyProps {
  icon: LucideIcon;
  message: string;
  actionLabel?: string;
  actionTo?: string;
}

/** Pusty stan sekcji: ikona w miękkim kółku, jedna linia, akcja. */
export function SectionEmpty({ icon: Icon, message, actionLabel, actionTo }: SectionEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
      {actionLabel && actionTo && (
        <Button asChild size="sm">
          <Link to={actionTo}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  );
}

/** Szkielet wierszy listy w sekcji. */
export function SectionRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-14 items-center gap-3 px-4">
          <Skeleton className="h-2 w-2 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

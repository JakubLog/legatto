import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  to: string;
  icon: LucideIcon;
  /** Klasy miękkiego kolorowego kwadratu z ikoną (tło + kolor ikony). */
  iconClassName: string;
  label: string;
  loading: boolean;
  /** Główna wartość (duża liczba lub krótki tekst). */
  value: ReactNode;
  /** Mniejszy wariant wartości dla tekstu zamiast liczby. */
  textValue?: boolean;
  /** Dodatkowa linia pod etykietą (np. rozbicie statusów). */
  footer?: ReactNode;
}

/**
 * Kafelek KPI pulpitu: ikona w miękkim kwadracie, duża wartość, etykieta, link do modułu.
 * W wąskim obszarze modułu (2 kafelki w rzędzie na telefonie) etykieta schodzi pod wartość,
 * żeby nie była ucinana obok ikony.
 */
export function KpiCard({ to, icon: Icon, iconClassName, label, loading, value, textValue = false, footer }: KpiCardProps) {
  return (
    <Link
      to={to}
      className="group flex min-w-0 max-w-full flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 text-card-foreground shadow-card transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background @max-sm:gap-2.5 @max-sm:p-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg @max-sm:h-8 @max-sm:w-8', iconClassName)}>
            <Icon className="h-[18px] w-[18px] @max-sm:h-4 @max-sm:w-4" />
          </div>
          <p className="truncate text-sm font-medium text-muted-foreground @max-sm:hidden">{label}</p>
        </div>
        <ArrowUpRight
          aria-hidden
          className="h-4 w-4 shrink-0 text-muted-foreground opacity-60 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground group-hover:opacity-100 md:opacity-0"
        />
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className={textValue ? 'h-6 w-28 max-w-full' : 'h-8 w-16'} />
          <Skeleton className="h-3 w-24 max-w-full" />
        </div>
      ) : (
        <div className="min-w-0 space-y-1">
          <div
            className={cn(
              'max-w-full overflow-hidden font-semibold tracking-tight',
              textValue
                ? 'truncate text-lg leading-snug first-letter:uppercase @max-sm:text-base'
                : 'text-3xl tabular-nums leading-none @max-sm:text-2xl',
            )}
          >
            {value}
          </div>
          <p className="hidden text-sm font-medium leading-snug text-muted-foreground @max-sm:block">{label}</p>
          {footer}
        </div>
      )}
    </Link>
  );
}

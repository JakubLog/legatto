import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { formatPLN } from '@/lib/expenses';
import { cn } from '@/lib/utils';
import { formatSignedPercent, type AmountDelta } from './derive';

interface CardProps {
  title: string;
  icon: LucideIcon;
  description?: ReactNode;
  /** Wartość/podsumowanie po prawej stronie nagłówka (np. suma). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Karta sekcji analityki: ikona + tytuł, opis, treść. */
export function AnalyticsCard({ title, icon: Icon, description, aside, className, children }: CardProps) {
  return (
    <Card className={cn('flex min-w-0 flex-col gap-3 p-4 max-md:p-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            aria-hidden
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{title}</h3>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {aside && <div className="shrink-0 text-right text-sm font-semibold tabular-nums">{aside}</div>}
      </div>
      {children}
    </Card>
  );
}

/** Pusty stan sekcji (brak danych lub brak sygnałów). */
export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">{children}</p>;
}

/**
 * Zmiana wydatków: wzrost = ostrzeżenie (bursztyn), spadek = oszczędność (zieleń).
 * Pokazuje procent, a gdy odniesienie = 0 - różnicę w złotych.
 */
export function DeltaBadge({ delta, title }: { delta: AmountDelta; title?: string }) {
  const tone = delta.diff > 0 ? 'up' : delta.diff < 0 ? 'down' : 'flat';
  const Icon = tone === 'up' ? ArrowUpRight : tone === 'down' ? ArrowDownRight : ArrowRight;
  const label =
    tone === 'flat'
      ? 'bez zmian'
      : delta.pct === null
        ? `${delta.diff > 0 ? '+' : '−'}${formatPLN(Math.abs(delta.diff))}`
        : formatSignedPercent(delta.pct);

  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
        tone === 'up' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
        tone === 'down' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        tone === 'flat' && 'bg-muted text-muted-foreground',
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

/** Odnośnik do wydatku (deep-link `?open=<id>` otwiera go w widoku Wydatki). */
export function ExpenseLink({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <Link
      to={`/biuro/budzet?open=${encodeURIComponent(id)}`}
      className={cn(
        'min-w-0 truncate font-medium underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Poziomy pasek udziału (0-100%). */
export function ShareBar({ percent, className, label }: { percent: number; className?: string; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
    >
      <div className={cn('h-full rounded-full bg-primary', className)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

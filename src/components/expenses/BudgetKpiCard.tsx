import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface Props {
  label: ReactNode;
  value: ReactNode;
  icon: LucideIcon;
  hint?: ReactNode;
  isLoading?: boolean;
  /** Klasy tła/tekstu bąbla ikony (np. kolor ostrzeżenia). */
  iconClassName?: string;
  valueClassName?: string;
  className?: string;
  children?: ReactNode;
}

/** Kafelek KPI budżetu: etykieta + ikona, duża wartość, podpowiedź, opcjonalna treść (np. pasek). */
export function BudgetKpiCard({
  label,
  value,
  icon: Icon,
  hint,
  isLoading = false,
  iconClassName,
  valueClassName,
  className,
  children,
}: Props) {
  return (
    <Card className={cn('p-4 max-md:p-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary',
            iconClassName,
          )}
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {isLoading ? (
        <Skeleton className="mt-1 h-8 w-32" />
      ) : (
        <p
          className={cn(
            'mt-1 text-2xl font-semibold tabular-nums tracking-tight max-md:break-words max-md:text-lg',
            valueClassName,
          )}
        >
          {value}
        </p>
      )}
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </Card>
  );
}

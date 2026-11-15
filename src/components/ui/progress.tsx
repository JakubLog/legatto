import * as React from 'react';
import { cn } from '@/lib/utils';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0..100 (over 100 dopuszczalne dla over-budget) */
  value: number;
  /** Override koloru paska (Tailwind class). Domyslnie auto na podstawie value. */
  indicatorClassName?: string;
}

function defaultIndicatorClass(value: number): string {
  if (value >= 100) return 'bg-destructive';
  if (value >= 85) return 'bg-orange-500';
  if (value >= 60) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ value, indicatorClassName, className, ...props }, ref) => {
    const pct = Number.isFinite(value) ? value : 0;
    const visual = Math.min(Math.max(pct, 0), 100);
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
        {...props}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500 ease-out',
            indicatorClassName ?? defaultIndicatorClass(pct),
          )}
          style={{ width: `${visual}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';

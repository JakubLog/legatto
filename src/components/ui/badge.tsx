import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium leading-4 transition-colors focus:outline-none focus:ring-2 focus:ring-ring/60 focus:ring-offset-2 [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-primary/10 text-primary dark:bg-primary/20',
        destructive: 'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20',
        outline: 'border-border bg-card text-foreground',
        success:
          'border-transparent bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
        warning:
          'border-transparent bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
        muted: 'border-transparent bg-muted text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

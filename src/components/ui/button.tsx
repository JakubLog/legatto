import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary-end',
        brand: 'bg-brand text-brand-foreground shadow-sm hover:bg-brand/90 hover:shadow-md active:bg-brand-end',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline:
          'border border-input bg-card shadow-sm hover:border-foreground/20 hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-brand underline-offset-4 hover:underline',
      },
      // max-md: większe cele dotykowe na telefonie; desktop (md+) bez zmian.
      size: {
        default: 'h-9 px-3.5 max-md:h-11 max-md:px-4',
        sm: 'h-8 px-3 text-[13px] max-md:h-10 max-md:px-3.5',
        lg: 'h-10 px-5 max-md:h-12',
        icon: 'h-9 w-9 max-md:h-11 max-md:w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };

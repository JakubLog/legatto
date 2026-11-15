import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Telefon: h-11 i text-base (cel dotykowy, brak auto-zoomu iOS); desktop: h-9 i text-sm.
 * Nadpisując wysokość/rozmiar tekstu podaj też wariant (`h-14 max-md:h-14`, `text-2xl md:text-2xl`),
 * bo `max-md:h-11` / `md:text-sm` wygrywają z klasą bez wariantu.
 */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-lg border border-input bg-card px-3 py-1.5 text-base shadow-sm transition-[border-color,box-shadow] duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/80 hover:border-foreground/20 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50 max-md:h-11 md:text-sm',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };

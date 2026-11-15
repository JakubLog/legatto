import * as React from 'react';
import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-lg border border-input bg-card px-3 py-2 text-base shadow-sm transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/80 hover:border-foreground/20 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };

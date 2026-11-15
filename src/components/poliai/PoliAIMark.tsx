import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PoliAIMarkProps {
  className?: string;
  iconClassName?: string;
  /** Płynący gradient (ekran startowy, trwająca odpowiedź). */
  animated?: boolean;
}

/** Znak PoliAI: iskry na gradiencie granat → bordo. */
export function PoliAIMark({ className, iconClassName, animated }: PoliAIMarkProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg text-primary-foreground shadow-sm',
        animated
          ? 'bg-gradient-to-br from-primary via-brand to-primary bg-[length:200%_200%] motion-safe:animate-gradient-flow'
          : 'bg-gradient-to-br from-primary to-brand',
        className,
      )}
    >
      <Sparkles className={cn('h-4 w-4', iconClassName)} />
    </span>
  );
}

/** Trzy pulsujące kropki - „czekam na odpowiedź” bez spinnera. */
export function PulsingDots({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('inline-flex items-center gap-1', className)}>
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:200ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:400ms]" />
    </span>
  );
}

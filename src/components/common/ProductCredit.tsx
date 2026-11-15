import { cn } from '@/lib/utils';

/** Podpis produktu. Jedyne miejsce w aplikacji z nazwą produktu. */
export function ProductCredit({ className }: { className?: string }) {
  return <p className={cn('text-[11px] leading-snug', className)}>This is Legatto. Built by no-fuss.</p>;
}

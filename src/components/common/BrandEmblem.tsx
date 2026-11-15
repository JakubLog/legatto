import { cn } from '@/lib/utils';

/** Znak portalu: godło (biały orzeł) na czerwonym tle marki. Rozmiar i zaokrąglenie z `className`. */
export function BrandEmblem({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('flex shrink-0 items-center justify-center rounded-lg bg-brand', className)}>
      <img src="/logo.svg" alt="" className="h-3/4 w-auto" />
    </span>
  );
}

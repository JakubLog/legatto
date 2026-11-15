import { Skeleton } from '@/components/ui/skeleton';

/** Szkielet karty mapy – fallback Suspense oraz stan wczytywania danych mapy. */
export function VisibilityMapSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm max-md:p-3">
      <div className="flex items-center justify-between gap-3 @max-md:flex-col @max-md:items-start">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-5 w-48 max-w-full rounded-full" />
      </div>
      <Skeleton className="mx-auto aspect-[8/5] w-full max-w-2xl rounded-lg" />
    </div>
  );
}

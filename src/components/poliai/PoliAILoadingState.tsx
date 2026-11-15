import { Skeleton } from '@/components/ui/skeleton';

/** Ładowanie poprzedniej rozmowy (po kliknięciu w historii). */
export function PoliAILoadingState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden px-5 py-8 md:px-8" aria-busy="true" aria-label="Ładowanie rozmowy">
      <div className="flex justify-end">
        <Skeleton className="h-9 w-2/3 max-w-xs rounded-2xl" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-7 w-7 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-2.5 pt-1">
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-3/5" />
        </div>
      </div>
    </div>
  );
}

import { cn } from '@/lib/utils';
import { publicContainer, publicInner, publicSkeleton } from '@/components/public/styles';

/**
 * Szkielet strony publicznej (hero) - fallback lazy-loadingu w PublicLayout
 * i stan ładowania treści strony (usePublicSite) w HomePage, żeby nie mignęły neutralne domyślne teksty.
 */
export function PublicPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Ładowanie strony">
      <div className="bg-card pb-14 pt-10 md:pb-20 md:pt-16">
        <div className={publicContainer}>
          <div
            className={cn(
              publicInner,
              'grid gap-12 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-center lg:gap-16',
            )}
          >
            <div className="space-y-5">
              <div className={cn(publicSkeleton, 'h-4 w-48 rounded-[4px]')} />
              <div className={cn(publicSkeleton, 'h-12 w-full max-w-xl')} />
              <div className={cn(publicSkeleton, 'h-12 w-3/4 max-w-md')} />
              <div className={cn(publicSkeleton, 'h-5 w-full max-w-lg')} />
              <div className="flex gap-3 pt-2">
                <div className={cn(publicSkeleton, 'h-12 w-40 rounded-lg')} />
                <div className={cn(publicSkeleton, 'h-12 w-40 rounded-lg')} />
              </div>
            </div>
            <div className={cn(publicSkeleton, 'aspect-[5/6] w-full max-w-[280px] justify-self-center rounded-[20px] sm:max-w-[320px] lg:aspect-[4/5] lg:max-w-none')} />
          </div>
        </div>
      </div>
    </div>
  );
}

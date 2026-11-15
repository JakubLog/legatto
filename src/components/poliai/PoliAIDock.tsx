import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { usePoliAIPanel } from './PoliAIProvider';

// Panel (z react-markdown) ładuje się dopiero przy pierwszym otwarciu - poza głównym bundlem.
const PoliAIPanel = lazy(() => import('./PoliAIPanel').then((m) => ({ default: m.PoliAIPanel })));

function PanelFallback() {
  return (
    <div className="flex h-full flex-col gap-4 p-4" aria-busy="true" aria-label="Ładowanie PoliAI">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="flex-1" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}

/**
 * Miejsce panelu PoliAI w układzie. Desktop: `<aside>` dokowany z prawej w wierszu pod TopBarem,
 * szerokość 0 → dokładnie 50% - obszar modułu zajmuje drugą połowę, TopBar i Sidebar bez zmian.
 * Mobile: pełny ekran nad BottomNav.
 */
export function PoliAIDock() {
  const panel = usePoliAIPanel();
  const open = panel?.open ?? false;
  const [loaded, setLoaded] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (open) {
      setLoaded(true);
      return;
    }
    // Zamknięty panel jest niewidoczny - fokus nie może w nim zostać.
    const active = document.activeElement;
    if (active instanceof HTMLElement && asideRef.current?.contains(active)) active.blur();
  }, [open]);

  if (!panel) return null;

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    panel.setOpen(false);
  };

  return (
    <aside
      ref={asideRef}
      aria-label="PoliAI"
      aria-hidden={!open}
      onKeyDown={handleKeyDown}
      className={cn(
        'fixed inset-0 z-50 flex flex-col overflow-hidden bg-card safe-top safe-bottom transition-[transform,visibility] duration-300 ease-out',
        'md:static md:inset-auto md:z-auto md:h-full md:shrink-0 md:translate-x-0 md:pb-0 md:pt-0 md:transition-[width,visibility]',
        open
          ? 'visible translate-x-0 md:w-1/2 md:border-l'
          : 'invisible translate-x-full md:w-0',
      )}
    >
      <div className="flex h-full w-full min-w-0 flex-col">
        {loaded && (
          <ChunkErrorBoundary>
            <Suspense fallback={<PanelFallback />}>
              <PoliAIPanel open={open} onClose={() => panel.setOpen(false)} />
            </Suspense>
          </ChunkErrorBoundary>
        )}
      </div>
    </aside>
  );
}

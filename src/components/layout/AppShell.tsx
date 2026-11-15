import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { PrivacyProvider, usePrivacy } from '@/contexts/PrivacyContext';
import { PrivacyOverlay } from '@/components/privacy/PrivacyOverlay';
import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchProvider } from '@/components/search/SearchProvider';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import { PoliAIProvider } from '@/components/poliai/PoliAIProvider';
import { PoliAIDock } from '@/components/poliai/PoliAIDock';
import { useAuth } from '@/contexts/AuthContext';
import { usePushSubscriptionSync } from '@/lib/pushSubscription';
import { APP_MAIN_ID } from './constants';

// Suspense lokalnie wokol Outlet - bez tego lazy-loaded strony pokazują
// fallback na poziomie App.tsx i wymontowuja cały AppShell (Sidebar + TopBar
// "migaja" przy nawigacji). Tutaj fallback dotyczy tylko zawartości main.
function MainFallback() {
  return (
    <div
      className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 md:px-8 md:py-6"
      aria-busy="true"
      aria-label="Ładowanie strony"
    >
      <div className="space-y-2">
        <Skeleton className="h-7 w-48 rounded-lg" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-full max-w-xs rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>
      <div className="space-y-2 rounded-xl border bg-card p-3 shadow-sm">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex h-10 items-center gap-3 px-1">
            <Skeleton className="h-2.5 w-2.5 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-5 w-20 rounded-full sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

// W trybie prywatnym tresc aplikacji nie jest renderowana - PII nie zostaje w DOM
// ani w kolejnosci fokusu pod overlayem PIN-u.
function ShellContent() {
  const { isLocked } = usePrivacy();
  if (isLocked) return null;

  return (
    <SearchProvider>
      <PoliAIProvider>
        {/* TopBar na pełnej szerokości kolumny; PoliAI dzieli na pół tylko wiersz pod nim (moduł | panel). */}
        <div className="flex h-full bg-background">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <div className="flex min-h-0 flex-1">
              {/* `@container`: treść modułów reaguje na szerokość obszaru modułu (`@md:` itd.), nie okna.
                  `relative`: elementy `absolute` bez pozycjonowanego przodka (np. `sr-only` przy polach radio)
                  należą do przewijanego obszaru - inaczej wystawały poza okno, a fokus przewijał <html>. */}
              <main
                id={APP_MAIN_ID}
                className="relative min-w-0 flex-1 overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] @container md:pb-0"
              >
                <ChunkErrorBoundary>
                  <Suspense fallback={<MainFallback />}>
                    <Outlet />
                  </Suspense>
                </ChunkErrorBoundary>
              </main>
              <PoliAIDock />
            </div>
            <BottomNav />
          </div>
        </div>
        <GlobalSearch />
      </PoliAIProvider>
    </SearchProvider>
  );
}

export function AppShell() {
  const { profile } = useAuth();
  usePushSubscriptionSync(profile?.id);
  return (
    <PrivacyProvider>
      <ShellContent />
      <PrivacyOverlay />
    </PrivacyProvider>
  );
}

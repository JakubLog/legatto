import { Link, Outlet } from 'react-router-dom';
import { Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Page } from './Page';

/**
 * Trasy konfiguracyjne (integracje, dziennik zmian, podział obowiązków) obsługujemy tylko na komputerze.
 * Na telefonie zamiast zagęszczonego panelu pokazujemy krótką informację i powrót na pulpit.
 */
export function DesktopOnlyRoute() {
  const isMobile = useIsMobile();
  if (!isMobile) return <Outlet />;

  return (
    <Page narrow>
      <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-12 text-center shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Monitor className="h-5 w-5" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Dostępne na komputerze</h1>
        <p className="max-w-xs text-sm text-muted-foreground">
          Ta sekcja służy do konfiguracji biura. Otwórz portal na komputerze, aby z niej skorzystać.
        </p>
        <Button asChild variant="outline" className="mt-2">
          <Link to="/biuro">Wróć na pulpit</Link>
        </Button>
      </div>
    </Page>
  );
}

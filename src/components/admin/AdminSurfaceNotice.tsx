import { ExternalLink, ShieldCheck } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { adminUrl } from '@/lib/adminSurface';
import { cn } from '@/lib/utils';

interface Props {
  /** Czego dotyczy blokada, np. „Eksport danych biura”. */
  feature?: string;
  className?: string;
}

/**
 * Informacja na powierzchni CRM (VPS) w miejscu funkcji wrażliwych: dostępne są tylko w panelu
 * administracyjnym (admin.app.<domena>, urządzenie biura). Link prowadzi do tej samej ścieżki w panelu.
 */
export function AdminSurfaceNotice({ feature, className }: Props) {
  const { pathname, search } = useLocation();
  const href = adminUrl(`${pathname}${search}`);

  return (
    <div
      role="note"
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 text-sm @sm:flex-row @sm:items-center @sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-400">
          <ShieldCheck className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium">
            {feature ? `${feature}: dostępne` : 'Dostępne'} tylko w panelu administracyjnym (urządzenie biura)
          </p>
          <p className="text-[13px] text-muted-foreground">
            Ze względów bezpieczeństwa ta funkcja działa wyłącznie na komputerze biura podłączonym do panelu
            administracyjnego.
          </p>
        </div>
      </div>
      {href && (
        <Button asChild variant="outline" className="shrink-0">
          <a href={href} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            Otwórz w panelu administracyjnym
          </a>
        </Button>
      )}
    </div>
  );
}

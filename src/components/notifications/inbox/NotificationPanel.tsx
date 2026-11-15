import { useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { BellOff, CheckCheck, Loader2, Settings, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { groupInboxByDay, type InboxItem } from '@/lib/notificationInbox';
import { NotificationListItem } from './NotificationListItem';

interface NotificationPanelProps {
  items: InboxItem[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  unreadCount: number;
  onMarkAll: () => void;
  onOpenItem: (item: InboxItem) => void;
  onClose: () => void;
}

/**
 * Zawartość dialogu dzwonka (Root i Trigger w NotificationBell). Desktop: panel zakotwiczony pod
 * dzwonkiem, przezroczysta nakładka (klik obok zamyka). Telefon: arkusz od dołu.
 */
export function NotificationPanel({
  items,
  isLoading,
  isError,
  onRetry,
  hasMore,
  isLoadingMore,
  onLoadMore,
  unreadCount,
  onMarkAll,
  onOpenItem,
  onClose,
}: NotificationPanelProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupInboxByDay(items), [items]);

  let list;
  if (isLoading) {
    list = (
      <div className="space-y-1 p-4" aria-busy="true">
        <span className="sr-only">Ładuję powiadomienia...</span>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 py-2">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (isError && items.length === 0) {
    list = (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <p className="text-sm font-medium">Nie udało się wczytać powiadomień</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Spróbuj ponownie
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    list = (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
          <BellOff className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium">Brak powiadomień</p>
        <p className="text-xs text-muted-foreground">Tu zobaczysz przypisane sprawy, wzmianki i decyzje.</p>
      </div>
    );
  } else {
    list = (
      <div className="pb-2">
        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`inbox-group-${group.key}`}>
            <h3
              id={`inbox-group-${group.key}`}
              className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {group.label}
            </h3>
            <ul className="divide-y">
              {group.items.map((item) => (
                <NotificationListItem key={item.id} item={item} onOpen={onOpenItem} />
              ))}
            </ul>
          </section>
        ))}
        <div className="px-4 pt-3 text-center">
          {hasMore ? (
            <Button type="button" variant="ghost" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
              {isLoadingMore && <Loader2 className="animate-spin" />}
              Pokaż starsze
            </Button>
          ) : (
            <p className="py-1 text-xs text-muted-foreground">To wszystkie powiadomienia z ostatnich 90 dni.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 md:bg-transparent" />
      <DialogPrimitive.Content
        ref={contentRef}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          // Fokus na panelu, nie na pierwszym przycisku („Oznacz wszystkie”).
          event.preventDefault();
          contentRef.current?.focus();
        }}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-xl border bg-card pb-[env(safe-area-inset-bottom)] shadow-popover duration-200 focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom md:inset-x-auto md:bottom-auto md:right-4 md:top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] md:max-h-[min(36rem,calc(100dvh-5rem))] md:w-[26rem] md:max-w-[calc(100vw-2rem)] md:rounded-xl md:pb-0 md:data-[state=closed]:fade-out-0 md:data-[state=open]:fade-in-0 md:data-[state=closed]:slide-out-to-top-2 md:data-[state=open]:slide-in-from-top-2"
      >
        <div className="shrink-0 border-b">
          <div className="flex items-center gap-1 py-1 pl-4 pr-1">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-base font-semibold">Powiadomienia</DialogPrimitive.Title>
            <Button asChild variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground md:h-9 md:w-9">
              <Link to="/biuro/profil#powiadomienia" onClick={onClose} aria-label="Ustawienia powiadomień" title="Ustawienia powiadomień">
                <Settings className="h-5 w-5 md:h-4 md:w-4" />
              </Link>
            </Button>
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground md:h-9 md:w-9" aria-label="Zamknij">
                <X className="h-5 w-5 md:h-4 md:w-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            Ostatnie powiadomienia w portalu. Kliknij pozycję, aby przejść do rekordu.
          </DialogPrimitive.Description>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pb-2">
            <p className="text-xs text-muted-foreground">
              {unreadCount > 0 ? `Nieprzeczytane: ${unreadCount}` : 'Wszystko przeczytane'}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-mr-2 h-auto min-h-11 max-w-full whitespace-normal px-2 py-1 text-left text-xs md:min-h-8"
              onClick={onMarkAll}
              disabled={unreadCount === 0 || items.length === 0}
            >
              <CheckCheck />
              Oznacz wszystkie jako przeczytane
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{list}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

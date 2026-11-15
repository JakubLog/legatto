import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Bell } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import {
  useInboxList,
  useInboxRealtime,
  useInboxUnreadCount,
  useMarkInboxRead,
} from '@/hooks/useNotificationInbox';
import { inboxHrefMatches, renderInboxItem, type InboxItem } from '@/lib/notificationInbox';
import { NotificationPanel } from './NotificationPanel';

/**
 * Dzwonek w TopBarze: licznik nieprzeczytanych, panel skrzynki, Realtime i auto-odczyt po wejściu
 * na link rekordu. Brak RPC w bazie (PGRST202) = dzwonek się nie renderuje. Treść powiadomień
 * pojawia się wyłącznie w otwartym panelu (bez toastów, bez licznika w tytule karty).
 */
export function NotificationBell() {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const countQ = useInboxUnreadCount();
  const count = countQ.data;
  const unread = typeof count === 'number' ? count : 0;
  const listQ = useInboxList(count !== null && (open || unread > 0));
  const { mutate: markMutate } = useMarkInboxRead();
  useInboxRealtime(count === null ? undefined : user?.id);

  const items = useMemo(() => listQ.data?.pages.flat() ?? [], [listQ.data]);

  // Jedna próba oznaczenia na pozycję (błąd RPC nie zapętla auto-odczytu).
  const attemptedRef = useRef(new Set<string>());
  const markRead = useCallback(
    (ids: string[]) => {
      const fresh = ids.filter((id) => !attemptedRef.current.has(id));
      if (fresh.length === 0) return;
      for (const id of fresh) attemptedRef.current.add(id);
      markMutate({ ids: fresh });
    },
    [markMutate],
  );

  // Auto-odczyt: wejście na adres rekordu (z dzwonka, push, e-maila, wyszukiwarki) oznacza
  // wczytane nieprzeczytane pozycje tego rekordu. Linki do list i profilu nie odczytują.
  useEffect(() => {
    const ids = items
      .filter((item) => {
        if (item.read_at) return false;
        const { href, record } = renderInboxItem(item.kind, item.payload);
        return record && inboxHrefMatches(href, pathname, search);
      })
      .map((item) => item.id);
    if (ids.length > 0) markRead(ids);
  }, [items, pathname, search, markRead]);

  // Komunikat dla czytnika ekranu tylko przy wzroście licznika po pierwszym wczytaniu.
  const prevCountRef = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (typeof count !== 'number') return;
    const prev = prevCountRef.current;
    prevCountRef.current = count;
    if (prev !== null && count > prev) setAnnouncement(`Nowe powiadomienie. Nieprzeczytane: ${count}.`);
  }, [count]);

  const handleOpenItem = useCallback(
    (item: InboxItem) => {
      if (!item.read_at) markRead([item.id]);
      setOpen(false);
    },
    [markRead],
  );

  const handleMarkAll = () => {
    const newest = items[0];
    if (newest) markMutate({ until: newest.created_at });
  };

  if (count === null) return null;

  const label = unread > 0 ? `Powiadomienia, nieprzeczytane: ${unread}` : 'Powiadomienia';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative h-11 w-11 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:h-9 md:w-9 max-md:h-[44px] max-md:w-[44px]"
          aria-label={label}
          title="Powiadomienia"
        >
          <Bell className="h-5 w-5 md:h-4 md:w-4" />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground md:-right-0.5 md:-top-0.5"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DialogPrimitive.Trigger>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      <NotificationPanel
        items={items}
        isLoading={listQ.isLoading}
        isError={listQ.isError}
        onRetry={() => void listQ.refetch()}
        hasMore={listQ.hasNextPage}
        isLoadingMore={listQ.isFetchingNextPage}
        onLoadMore={() => void listQ.fetchNextPage()}
        unreadCount={unread}
        onMarkAll={handleMarkAll}
        onOpenItem={handleOpenItem}
        onClose={() => setOpen(false)}
      />
    </DialogPrimitive.Root>
  );
}

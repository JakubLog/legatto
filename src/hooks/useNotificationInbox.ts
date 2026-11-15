import { useEffect } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { InboxItem } from '@/lib/notificationInbox';

// Skrzynka powiadomień w aplikacji (dzwonek w TopBarze). Dane zawsze z RPC
// (get_my_inbox, get_my_inbox_unread_count, mark_my_inbox_read; własne wiersze, aal2).
// Realtime (postgres_changes na notification_inbox) jest tylko sygnałem do odświeżenia.

export const INBOX_KEY = ['notifications', 'inbox'] as const;
const UNREAD_KEY = [...INBOX_KEY, 'unread'] as const;
const LIST_KEY = [...INBOX_KEY, 'list'] as const;

export const INBOX_PAGE_SIZE = 30;

/** Kursor strony: surowe `created_at` (tekst z odpowiedzi, z mikrosekundami) i `id` ostatniego wiersza. */
interface InboxCursor {
  before: string;
  beforeId: string;
}

type InboxPages = InfiniteData<InboxItem[], InboxCursor | null>;

/** null = baza bez RPC skrzynki (PGRST202) → dzwonek się nie renderuje. */
export function useInboxUnreadCount() {
  return useQuery<number | null>({
    queryKey: UNREAD_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_inbox_unread_count');
      if (error) {
        if (error.code === 'PGRST202') return null;
        throw error;
      }
      return typeof data === 'number' ? data : 0;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
  });
}

/** Strony po 30, najnowsze najpierw. */
export function useInboxList(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: LIST_KEY,
    initialPageParam: null as InboxCursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await supabase
        .rpc('get_my_inbox', {
          p_limit: INBOX_PAGE_SIZE,
          p_before: pageParam?.before ?? null,
          p_before_id: pageParam?.beforeId ?? null,
        })
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as InboxItem[];
    },
    getNextPageParam: (lastPage): InboxCursor | null => {
      const last = lastPage[lastPage.length - 1];
      return lastPage.length < INBOX_PAGE_SIZE || !last ? null : { before: last.created_at, beforeId: last.id };
    },
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** `ids` = wskazane pozycje; `until` = wszystkie nieprzeczytane do tej chwili włącznie. */
export type MarkInboxReadInput = { ids: string[] } | { until: string };

export function useMarkInboxRead() {
  const qc = useQueryClient();
  return useMutation<number, Error, MarkInboxReadInput, { list?: InboxPages; unread?: number | null }>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'mark_my_inbox_read',
        'ids' in input ? { p_ids: input.ids, p_until: null } : { p_ids: null, p_until: input.until },
      );
      if (error) throw error;
      return typeof data === 'number' ? data : 0;
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: INBOX_KEY });
      const list = qc.getQueryData<InboxPages>(LIST_KEY);
      const unread = qc.getQueryData<number | null>(UNREAD_KEY);
      const ids = 'ids' in input ? new Set(input.ids) : null;
      const until = 'until' in input ? new Date(input.until).getTime() : null;
      const now = new Date().toISOString();
      let marked = 0;
      if (list) {
        qc.setQueryData<InboxPages>(LIST_KEY, {
          ...list,
          pages: list.pages.map((page) =>
            page.map((item) => {
              if (item.read_at) return item;
              const hit = ids ? ids.has(item.id) : until !== null && new Date(item.created_at).getTime() <= until;
              if (!hit) return item;
              marked += 1;
              return { ...item, read_at: now };
            }),
          ),
        });
      }
      if (typeof unread === 'number') {
        qc.setQueryData<number | null>(UNREAD_KEY, Math.max(0, unread - (ids && !list ? ids.size : marked)));
      }
      return { list, unread };
    },
    onError: (_error, _input, context) => {
      if (context?.list) qc.setQueryData(LIST_KEY, context.list);
      if (context && context.unread !== undefined) qc.setQueryData(UNREAD_KEY, context.unread);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: INBOX_KEY });
    },
  });
}

/** Jeden kanał na kartę; zdarzenie = unieważnienie INBOX_KEY (z opóźnieniem 300 ms). */
export function useInboxRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    let joined = false;
    let timer: number | undefined;
    // Zalew zdarzeń (np. zgłoszenia z formularza) = jedno odświeżenie.
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void qc.invalidateQueries({ queryKey: INBOX_KEY }), 300);
    };
    const filter = `user_id=eq.${userId}`;
    const channel = supabase
      .channel(`inbox-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_inbox', filter }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notification_inbox', filter }, refresh)
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        // Powrót po zerwaniu połączenia: nadrób zgubione zdarzenia.
        if (joined) refresh();
        joined = true;
      });
    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}

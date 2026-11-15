import { Link } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { pl } from 'date-fns/locale';

import { cn } from '@/lib/utils';
import { renderInboxItem, type InboxItem } from '@/lib/notificationInbox';

interface NotificationListItemProps {
  item: InboxItem;
  /** Kliknięcie pozycji (przed nawigacją Linka): oznaczenie jako przeczytanej i zamknięcie panelu. */
  onOpen: (item: InboxItem) => void;
}

/** Wiersz skrzynki: cały wiersz to link do rekordu (treść wyłącznie jako węzły tekstowe). */
export function NotificationListItem({ item, onOpen }: NotificationListItemProps) {
  const { title, body, href, icon: Icon } = renderInboxItem(item.kind, item.payload);
  const unread = !item.read_at;
  const created = new Date(item.created_at);
  const validDate = !Number.isNaN(created.getTime());

  return (
    <li>
      <Link
        to={href}
        onClick={() => onOpen(item)}
        className={cn(
          'flex min-h-14 items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          unread && 'bg-primary/[0.04]',
        )}
      >
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className={cn('block text-sm leading-snug text-foreground', unread ? 'font-semibold' : 'font-medium')}>
            {unread && <span className="sr-only">Nieprzeczytane: </span>}
            {title}
          </span>
          {body && <span className="line-clamp-2 block text-xs text-muted-foreground">{body}</span>}
          {validDate && (
            <time
              dateTime={item.created_at}
              title={format(created, 'd MMMM yyyy, HH:mm', { locale: pl })}
              className="block text-[11px] text-muted-foreground"
            >
              {formatDistanceToNow(created, { addSuffix: true, locale: pl })}
            </time>
          )}
        </span>
        {unread && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />}
      </Link>
    </li>
  );
}

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { Skeleton } from '@/components/ui/skeleton';
import { InterpellationDeadline } from '@/components/interpellations/InterpellationDeadline';
import { InterpellationRowActions } from '@/components/interpellations/InterpellationRowActions';
import { sortByUrgency } from '@/components/interpellations/urgency';
import {
  INTERPELLATION_STATUSES,
  INTERPELLATION_STATUS_DOT,
  INTERPELLATION_STATUS_LABELS,
  INTERPELLATION_STATUS_SHORT,
} from '@/lib/interpellations';
import { cn } from '@/lib/utils';
import type { InterpellationListItem, InterpellationStatus } from '@/integrations/supabase/types';

interface Props {
  items: InterpellationListItem[];
  isLoading: boolean;
  writer: boolean;
  admin: boolean;
  onMarkSent: (i: InterpellationListItem) => void;
  onDelete: (i: InterpellationListItem) => void;
}

const COLUMN = 'flex w-[85vw] max-w-80 shrink-0 snap-start flex-col rounded-xl border bg-muted/30 @sm:w-72';

/**
 * Tablica etapów obiegu: kolumna na status, karty wg pilności.
 * Bez przeciągania - przejścia wymagają decyzji Posła albo potwierdzenia wysyłki w dialogu.
 */
export function InterpellationsBoard({ items, isLoading, writer, admin, onMarkSent, onDelete }: Props) {
  const columns = useMemo(() => {
    const byStatus = Object.fromEntries(
      INTERPELLATION_STATUSES.map((s) => [s, [] as InterpellationListItem[]]),
    ) as Record<InterpellationStatus, InterpellationListItem[]>;
    for (const it of sortByUrgency(items)) byStatus[it.status].push(it);
    return INTERPELLATION_STATUSES.map((status) => ({ status, items: byStatus[status] }));
  }, [items]);

  return (
    // items-start: pusta kolumna kończy się pod "Brak interpelacji", zamiast ciągnąć się pustym tłem do wysokości najdłuższej.
    <div className="-mx-4 flex snap-x items-start gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
      {columns.map(({ status, items: columnItems }) => (
        <section key={status} aria-label={INTERPELLATION_STATUS_LABELS[status]} className={COLUMN}>
          <header className="flex items-center gap-2 px-3 py-2.5" title={INTERPELLATION_STATUS_LABELS[status]}>
            <span className={cn('h-2 w-2 rounded-full', INTERPELLATION_STATUS_DOT[status])} aria-hidden />
            <h2 className="truncate text-sm font-semibold">
              {status === 'odrzucona' ? 'Archiwum' : INTERPELLATION_STATUS_SHORT[status]}
            </h2>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {isLoading ? '…' : columnItems.length}
            </span>
          </header>
          <ul className="flex max-h-[calc(100dvh-17rem)] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">
            {isLoading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <li key={i} className="space-y-2 rounded-lg border bg-card p-3">
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-3 w-1/2" />
                </li>
              ))
            ) : columnItems.length === 0 ? (
              <li className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                Brak interpelacji
              </li>
            ) : (
              columnItems.map((it) => (
                <BoardCard
                  key={it.id}
                  item={it}
                  writer={writer}
                  admin={admin}
                  onMarkSent={onMarkSent}
                  onDelete={onDelete}
                />
              ))
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface CardProps {
  item: InterpellationListItem;
  writer: boolean;
  admin: boolean;
  onMarkSent: (i: InterpellationListItem) => void;
  onDelete: (i: InterpellationListItem) => void;
}

function BoardCard({ item, writer, admin, onMarkSent, onDelete }: CardProps) {
  return (
    <li className="group relative rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/40">
      <div className="flex items-start gap-2">
        <Link
          to={`/biuro/interpelacje/${item.id}`}
          className="line-clamp-2 min-w-0 flex-1 text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:underline"
        >
          <span className="sr-only">Interpelacja w sprawie: </span>
          {item.subject}
        </Link>
        <div className="relative z-10 -mr-1.5 -mt-1.5">
          <InterpellationRowActions
            item={item}
            writer={writer}
            admin={admin}
            onMarkSent={onMarkSent}
            onDelete={onDelete}
          />
        </div>
      </div>

      <p className="mt-1 truncate text-xs text-muted-foreground">
        Odbiorca: <span className="text-foreground">{item.recipient}</span>
      </p>

      {item.status === 'uwagi' && item.review_notes && (
        <p className="mt-2 line-clamp-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-900 dark:text-amber-200">
          {item.review_notes}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        {item.creator && (
          <CreatorAvatar name={item.creator.full_name} avatarUrl={item.creator.avatar_url} className="h-5 w-5" />
        )}
        {item.status === 'zaakceptowana' && item.deadline_at ? (
          <InterpellationDeadline deadlineAt={item.deadline_at} />
        ) : (
          <BoardCardDate item={item} />
        )}
        {item.revision > 1 && <span className="ml-auto tabular-nums">wersja {item.revision}</span>}
      </div>
    </li>
  );
}

/** Data najistotniejsza dla etapu: wysłania, archiwizacji albo wgrania treści. */
function BoardCardDate({ item }: { item: InterpellationListItem }) {
  const [label, iso] =
    item.status === 'wyslana' && item.sent_at
      ? ['wysłano', item.sent_at]
      : item.status === 'odrzucona' && item.archived_at
        ? ['odrzucono', item.archived_at]
        : ['wgrano', item.submitted_at];
  return (
    <span className="whitespace-nowrap">
      {label} {format(new Date(iso), 'd MMM', { locale: pl })}
    </span>
  );
}

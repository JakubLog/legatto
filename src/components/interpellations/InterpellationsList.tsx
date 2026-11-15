import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { Skeleton } from '@/components/ui/skeleton';
import { InterpellationDeadline } from '@/components/interpellations/InterpellationDeadline';
import { InterpellationStatusPill } from '@/components/interpellations/InterpellationStatusPill';
import { InterpellationRowActions } from '@/components/interpellations/InterpellationRowActions';
import type { InterpellationListItem } from '@/integrations/supabase/types';
import { canWrite, isAdmin } from '@/lib/permissions';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface Props {
  items: InterpellationListItem[];
  isLoading: boolean;
  onMarkSent: (i: InterpellationListItem) => void;
  onDelete: (i: InterpellationListItem) => void;
  /** Widok pustej listy (inny dla braku danych i pustego filtra). */
  emptyState: ReactNode;
}

/** Wspólny szablon kolumn nagłówka i wierszy (szeroki obszar modułu). */
const COLUMNS =
  '@md:grid @md:grid-cols-[minmax(0,1fr)_10rem_10rem_8rem_5.5rem] @lg:grid-cols-[minmax(0,1fr)_12rem_12rem_9rem_5.5rem]';


export function InterpellationsList({ items, isLoading, onMarkSent, onDelete, emptyState }: Props) {
  const { profile } = useAuth();
  const admin = isAdmin(profile?.role);
  const writer = canWrite(profile?.role);

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="hidden h-5 w-20 rounded-full @md:block" />
            <Skeleton className="hidden h-4 w-24 @lg:block" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) return <>{emptyState}</>;

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div
        className={`hidden items-center gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground ${COLUMNS}`}
      >
        <span>Temat i odbiorca</span>
        <span>Status</span>
        <span>Autor</span>
        <span>Wgrano</span>
        <span className="sr-only">Akcje</span>
      </div>
      <ul>
        {items.map((it) => {
          const sendable = writer && it.status === 'zaakceptowana';
          return (
            <li
              key={it.id}
              className={`group relative flex items-center gap-3 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/60 @max-md:block ${COLUMNS}`}
            >
              <div className="min-w-0 flex-1">
                {/* Wąski obszar: etap i termin na górze (obok akcji), tytuł pod nimi na pełnej szerokości. */}
                <div
                  className={cn(
                    'mb-0.5 flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 @md:hidden',
                    (writer || admin) && (sendable ? 'pr-[6.5rem]' : 'pr-14'),
                  )}
                >
                  <InterpellationStatusPill status={it.status} />
                  {it.status === 'zaakceptowana' && it.deadline_at && (
                    <InterpellationDeadline deadlineAt={it.deadline_at} />
                  )}
                </div>
                <Link
                  to={`/biuro/interpelacje/${it.id}`}
                  className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline @max-md:line-clamp-3 @max-md:whitespace-normal @max-md:break-words @max-md:text-[15px] @max-md:leading-snug"
                >
                  <span className="sr-only">Interpelacja w sprawie: </span>
                  {it.subject}
                </Link>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground @max-md:mt-1">
                  <span className="truncate @max-md:whitespace-normal @max-md:break-words">Odbiorca: {it.recipient}</span>
                  {it.revision > 1 && <span>wersja {it.revision}</span>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground @md:hidden">
                  {it.creator?.full_name ?? 'Autor nieznany'} · wgrano{' '}
                  {format(new Date(it.submitted_at), 'd MMM yyyy', { locale: pl })}
                </p>
              </div>

              <div className="hidden min-w-0 @md:block">
                <InterpellationStatusPill status={it.status} />
                {it.status === 'zaakceptowana' && it.deadline_at && (
                  <InterpellationDeadline deadlineAt={it.deadline_at} className="mt-1" />
                )}
              </div>

              <div className="hidden min-w-0 items-center gap-2 @md:flex">
                {it.creator ? (
                  <>
                    <CreatorAvatar
                      name={it.creator.full_name}
                      avatarUrl={it.creator.avatar_url}
                      className="h-6 w-6"
                    />
                    <span className="truncate text-[13px]">{it.creator.full_name}</span>
                  </>
                ) : (
                  <span className="text-[13px] text-muted-foreground">—</span>
                )}
              </div>

              <span className="hidden text-[13px] text-muted-foreground @md:block">
                {format(new Date(it.submitted_at), 'd MMM yyyy', { locale: pl })}
              </span>

              {/* Wąski obszar: akcje w prawym górnym rogu, na wysokości etapu. */}
              <div className="relative z-10 flex items-center justify-end @max-md:absolute @max-md:right-2 @max-md:top-3 @max-md:h-11">
                <InterpellationRowActions
                  item={it}
                  writer={writer}
                  admin={admin}
                  onMarkSent={onMarkSent}
                  onDelete={onDelete}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

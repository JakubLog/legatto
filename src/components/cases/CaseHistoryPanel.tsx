import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  AlertCircle,
  CalendarClock,
  CircleDot,
  FilePlus2,
  Flag,
  Lock,
  type LucideIcon,
  Paperclip,
  Pencil,
  RefreshCw,
  Tag,
  Trash2,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { useAuth } from '@/contexts/AuthContext';
import {
  useCaseActivity,
  useCaseComments,
  useCaseHistoryRealtime,
  useDeleteCaseComment,
} from '@/hooks/useCaseHistory';
import { useMovedToTrashToast } from '@/hooks/useTrash';
import { useAssignableUsers } from '@/hooks/useUsers';
import { describeCaseActivity, splitMentions, timelineDayLabel } from '@/lib/caseHistory';
import { canWrite, isAdmin } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { CaseActivity, CaseActivityKind, CaseComment } from '@/integrations/supabase/types';
import { CaseCommentComposer } from './CaseCommentComposer';

const ACTIVITY_ICON: Record<CaseActivityKind, LucideIcon> = {
  created: FilePlus2,
  status: CircleDot,
  assigned: UserRound,
  priority: Flag,
  due_date: CalendarClock,
  category: Tag,
  title: Pencil,
  description: Pencil,
  attachment_added: Paperclip,
  attachment_removed: Paperclip,
};

type TimelineItem =
  | { type: 'activity'; at: string; item: CaseActivity }
  | { type: 'comment'; at: string; item: CaseComment };

interface Props {
  caseId: string;
  /** id panelu zakładki „Historia” (poniżej lg). */
  panelId?: string;
  className?: string;
}

/**
 * Historia sprawy: jedna oś czasu (najstarsze u góry, najnowsze na dole - jak czat) z wpisów
 * dziennika i komentarzy + pole komentarza przypięte na dole. Na lg panel przewija się sam
 * (prawa kolumna okna), niżej płynie w przewijanym arkuszu, a pole komentarza jest `sticky`.
 */
export function CaseHistoryPanel({ caseId, panelId, className }: Props) {
  const { profile } = useAuth();
  const writer = canWrite(profile?.role);
  const admin = isAdmin(profile?.role);
  const activity = useCaseActivity(caseId);
  const comments = useCaseComments(caseId);
  const { data: users = [] } = useAssignableUsers();
  useCaseHistoryRealtime(caseId);
  const scrollRef = useRef<HTMLDivElement>(null);

  const nameById = useMemo(() => new Map(users.map((u) => [u.id, u.full_name])), [users]);

  const items = useMemo<TimelineItem[]>(() => {
    const all: TimelineItem[] = [
      ...(activity.data ?? []).map((item) => ({ type: 'activity' as const, at: item.created_at, item })),
      ...(comments.data ?? []).map((item) => ({ type: 'comment' as const, at: item.created_at, item })),
    ];
    // Ten sam moment: najpierw zmiana, potem komentarz do niej.
    return all.sort((a, b) => a.at.localeCompare(b.at) || (a.type === b.type ? 0 : a.type === 'activity' ? -1 : 1));
  }, [activity.data, comments.data]);

  const isLoading = activity.isLoading || comments.isLoading;
  const isError = activity.isError || comments.isError;
  const lastId = items[items.length - 1]?.item.id;

  // Najnowsze na dole: po wczytaniu i po każdym nowym wpisie przewiń kolumnę (lg) na dół.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
  }, [lastId, isLoading]);

  const commentCount = comments.data?.length ?? 0;

  return (
    <section
      id={panelId}
      role="tabpanel"
      aria-label="Historia sprawy"
      className={cn('flex min-h-0 flex-col', className)}
    >
      <header className="flex items-baseline justify-between gap-3 max-lg:hidden lg:border-b lg:px-5 lg:py-4 lg:pr-14">
        <h3 className="text-sm font-semibold">Historia</h3>
        {commentCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {commentCount} {commentCount === 1 ? 'komentarz' : commentCount % 10 >= 2 && commentCount % 10 <= 4 && (commentCount % 100 < 12 || commentCount % 100 > 14) ? 'komentarze' : 'komentarzy'}
          </span>
        )}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 lg:overflow-y-auto lg:px-5 lg:py-4">
        {isLoading ? (
          <div className="space-y-4" aria-busy="true" aria-label="Wczytywanie historii">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <AlertCircle className="h-4 w-4" />
              Nie udało się wczytać historii.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="max-md:h-11"
              onClick={() => {
                void activity.refetch();
                void comments.refetch();
              }}
            >
              <RefreshCw />
              Spróbuj ponownie
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Brak wpisów w historii.</p>
        ) : (
          <ol className="space-y-4">
            {items.map((entry, i) => {
              const day = timelineDayLabel(new Date(entry.at));
              const prevDay = i > 0 ? timelineDayLabel(new Date(items[i - 1].at)) : null;
              return (
                <Fragment key={`${entry.type}-${entry.item.id}`}>
                  {day !== prevDay && (
                    <li aria-hidden className="flex items-center gap-3 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span className="h-px flex-1 bg-border" />
                      {day}
                      <span className="h-px flex-1 bg-border" />
                    </li>
                  )}
                  {entry.type === 'activity' ? (
                    <ActivityRow item={entry.item} />
                  ) : (
                    <CommentRow
                      item={entry.item}
                      mentionNames={entry.item.mentions.map((id) => nameById.get(id)).filter((n): n is string => Boolean(n))}
                      myName={profile?.full_name ?? null}
                      mentionsMe={Boolean(profile?.id && entry.item.mentions.includes(profile.id))}
                      canDelete={Boolean(profile?.id && (entry.item.author_id === profile.id || admin))}
                    />
                  )}
                </Fragment>
              );
            })}
            {commentCount === 0 && (
              <li className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
                {writer ? 'Brak komentarzy. Napisz pierwszy - wpisz @, aby oznaczyć osobę.' : 'Brak komentarzy.'}
              </li>
            )}
          </ol>
        )}
      </div>

      <div
        className={cn(
          'z-10 bg-card pt-3',
          // Poniżej lg: przypięte do dołu przewijanego arkusza (pokrywa dolny padding okna jak DialogFooter).
          'max-lg:sticky max-lg:-bottom-6 max-lg:-mb-6 max-lg:pb-6',
          'max-md:-bottom-[calc(1.5rem+env(safe-area-inset-bottom))] max-md:-mb-[calc(1.5rem+env(safe-area-inset-bottom))] max-md:pb-[calc(1.5rem+env(safe-area-inset-bottom))]',
          'lg:border-t lg:px-5 lg:pb-5 lg:pt-4',
        )}
      >
        {writer ? (
          <CaseCommentComposer
            key={caseId}
            caseId={caseId}
            onSent={() => requestAnimationFrame(() => {
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            })}
          />
        ) : (
          <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Masz dostęp tylko do odczytu. Komentarze dodają osoby z prawem edycji spraw.
          </p>
        )}
      </div>
    </section>
  );
}

function ActivityRow({ item }: { item: CaseActivity }) {
  const Icon = ACTIVITY_ICON[item.kind] ?? CircleDot;
  const { text, detail } = describeCaseActivity(item);
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-muted/60 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm leading-snug">{text}</p>
        {detail && <p className="truncate text-xs text-muted-foreground" title={detail}>„{detail}”</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {item.actor?.full_name ?? 'System'} · <time dateTime={item.created_at}>{format(new Date(item.created_at), 'HH:mm')}</time>
        </p>
      </div>
    </li>
  );
}

interface CommentRowProps {
  item: CaseComment;
  mentionNames: string[];
  myName: string | null;
  mentionsMe: boolean;
  canDelete: boolean;
}

function CommentRow({ item, mentionNames, myName, mentionsMe, canDelete }: CommentRowProps) {
  const [confirming, setConfirming] = useState(false);
  const deleteMut = useDeleteCaseComment();
  const movedToTrash = useMovedToTrashToast();
  const author = item.author?.full_name ?? 'Usunięte konto';
  const parts = splitMentions(item.body, mentionNames);

  const handleDelete = async () => {
    try {
      await deleteMut.mutateAsync({ id: item.id, caseId: item.case_id });
      movedToTrash('case_comment', item.id, 'Komentarz w koszu');
    } catch (err) {
      setConfirming(false);
      toast.error('Nie udało się usunąć komentarza', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  return (
    <li className="group flex gap-3">
      <CreatorAvatar
        name={author}
        avatarUrl={item.author?.avatar_url}
        className="mt-0.5 h-8 w-8 shrink-0 ring-0"
        fallbackClassName="text-[11px]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 truncate text-sm font-medium">{author}</p>
          <time dateTime={item.created_at} className="shrink-0 text-xs text-muted-foreground">
            {format(new Date(item.created_at), 'HH:mm')}
          </time>
          {canDelete && !confirming && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive max-md:-my-1.5 max-md:h-11 max-md:w-11 md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100"
              aria-label="Usuń komentarz"
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div
          className={cn(
            'mt-1 whitespace-pre-wrap break-words rounded-lg rounded-tl-sm border px-3 py-2 text-sm',
            mentionsMe ? 'border-primary/30 bg-primary/5' : 'bg-muted/40',
          )}
        >
          {parts.map((p, i) =>
            p.mention ? (
              <span
                key={i}
                className={cn(
                  'rounded px-0.5 font-medium',
                  myName && p.text === `@${myName}` ? 'bg-primary/15 text-primary' : 'text-primary',
                )}
              >
                {p.text}
              </span>
            ) : (
              <Fragment key={i}>{p.text}</Fragment>
            ),
          )}
        </div>
        {confirming && (
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2 text-xs">
            <span className="mr-auto text-muted-foreground">Przenieść komentarz do kosza?</span>
            <Button type="button" variant="outline" size="sm" className="max-md:h-11" onClick={() => setConfirming(false)} disabled={deleteMut.isPending}>
              Anuluj
            </Button>
            <Button type="button" variant="destructive" size="sm" className="max-md:h-11" onClick={() => void handleDelete()} disabled={deleteMut.isPending}>
              Przenieś do kosza
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

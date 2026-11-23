import { useState } from 'react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { CalendarClock, Clock, Copy, ExternalLink, Loader2, Mail, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { GrNewsletter } from '@/hooks/useGetResponse';
import { useDeleteNewsletter } from '@/hooks/useGetResponse';
import { newsletterWebUrl, type NewsletterIssueSummary } from '@/hooks/useNewsletterIssues';
import { usePublicSiteUrl } from '@/hooks/useSitePublish';
import { cn } from '@/lib/utils';

interface Props {
  newsletters: GrNewsletter[];
  isLoading: boolean;
  error: Error | null;
  /** Akcja pustego stanu (tylko gdy użytkownik może tworzyć kampanie). */
  onCreate?: () => void;
  /** Wydania wysłane z aplikacji po id newslettera GR - wersja online i duplikowanie. */
  issuesByGrId?: Record<string, NewsletterIssueSummary>;
  onDuplicate?: (issue: NewsletterIssueSummary) => void;
  duplicatingId?: string | null;
  /** Na telefonie lista bez operacji modyfikujących kampanie. */
  readOnly?: boolean;
}

const STATUS_STYLES: Record<string, { label: string; dot: string; pill: string; pulse?: boolean }> = {
  sent: {
    label: 'Wysłana',
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  enqueued: {
    label: 'W kolejce',
    dot: 'bg-amber-500',
    pill: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    pulse: true,
  },
  processing: {
    label: 'W trakcie',
    dot: 'bg-amber-500',
    pill: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    pulse: true,
  },
  sending: {
    label: 'W trakcie',
    dot: 'bg-amber-500',
    pill: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    pulse: true,
  },
  scheduled: { label: 'Zaplanowana', dot: 'bg-sky-500', pill: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  draft: { label: 'Szkic', dot: 'bg-muted-foreground/60', pill: 'bg-muted text-muted-foreground' },
  failed: { label: 'Błąd', dot: 'bg-destructive', pill: 'bg-destructive/10 text-destructive' },
  error: { label: 'Błąd', dot: 'bg-destructive', pill: 'bg-destructive/10 text-destructive' },
};

function StatusPill({ status, className }: { status?: string; className?: string }) {
  const style = STATUS_STYLES[(status ?? '').toLowerCase()] ?? {
    label: status ?? '?',
    dot: 'bg-muted-foreground/60',
    pill: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        style.pill,
        className,
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', style.dot, style.pulse && 'animate-pulse')} />
      {style.label}
    </span>
  );
}

function formatDate(value?: string) {
  if (!value) return '—';
  try {
    return format(new Date(value), 'd MMM yyyy, HH:mm', { locale: pl });
  } catch {
    return value;
  }
}

export function CampaignsList({
  newsletters,
  isLoading,
  error,
  onCreate,
  issuesByGrId = {},
  onDuplicate,
  duplicatingId = null,
  readOnly = false,
}: Props) {
  const deleteMut = useDeleteNewsletter();
  const publicSiteUrl = usePublicSiteUrl().data ?? '';
  const [toDelete, setToDelete] = useState<GrNewsletter | null>(null);

  const handleDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteMut.mutateAsync(toDelete.newsletterId);
      toast.success('Kampania usunięta z GetResponse');
    } catch (err) {
      toast.error('Nie udało się usunąć kampanii', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    } finally {
      setToDelete(null);
    }
  };

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label="Ładuje historię kampanii z GetResponse"
        className="divide-y rounded-xl border bg-card shadow-sm"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 max-md:px-3">
            <Skeleton className="h-8 w-8 rounded-lg @max-md:hidden" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-56 @max-md:w-full @max-md:max-w-40" />
              <Skeleton className="h-3 w-32 @max-md:max-w-28" />
            </div>
            <Skeleton className="h-5 w-20 rounded-full @max-md:w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-1 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm">
        <p className="font-medium text-destructive">Nie udało się pobrać historii kampanii</p>
        <p className="break-words text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  if (newsletters.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Mail className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">{readOnly ? 'Brak kampanii.' : 'Brak kampanii. Wyślij pierwszy newsletter.'}</p>
        {onCreate && (
          <Button size="sm" onClick={onCreate}>
            <Plus />
            Nowa kampania
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
        {newsletters.map((n) => {
          const issue = issuesByGrId[n.newsletterId];
          return (
            <li
              key={n.newsletterId}
              className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60 @max-md:flex-wrap @max-md:gap-x-2 @max-md:gap-y-2 max-md:px-3 max-md:py-3"
            >
              <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary @md:flex">
                <Mail className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 @max-md:order-1 @max-md:basis-full">
                <p className="truncate text-sm font-medium">{n.subject ?? '(brak tematu)'}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {n.name && n.name !== n.subject && <span className="truncate">{n.name}</span>}
                  <span className="inline-flex items-center gap-1" title="Wysłano">
                    {n.sendOn ? (
                      <>
                        <CalendarClock className="h-3 w-3" />
                        {formatDate(n.sendOn)}
                      </>
                    ) : (
                      <>
                        <Clock className="h-3 w-3" /> nie zaplanowano
                      </>
                    )}
                  </span>
                  <span className="hidden @md:inline">Utworzono {formatDate(n.createdOn)}</span>
                </div>
              </div>
              {issue && (
                <div className="flex shrink-0 items-center gap-2 @max-md:order-3 @max-md:ml-auto">
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" asChild>
                    <a href={newsletterWebUrl(issue.slug, publicSiteUrl)} target="_blank" rel="noopener noreferrer" title="Wersja online">
                      <ExternalLink className="h-4 w-4" />
                      <span className="hidden @lg:inline @max-md:inline">Online</span>
                    </a>
                  </Button>
                  {onDuplicate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-muted-foreground"
                      onClick={() => onDuplicate(issue)}
                      disabled={duplicatingId !== null}
                      title="Duplikuj jako nowy newsletter"
                    >
                      {duplicatingId === issue.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                      <span className="hidden @lg:inline @max-md:inline">Duplikuj</span>
                    </Button>
                  )}
                </div>
              )}
              <StatusPill status={n.status} className="@max-md:order-2" />
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0 @max-md:order-4"
                  onClick={() => setToDelete(n)}
                  aria-label="Usuń kampanię"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {!readOnly && (
        <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Usuń kampanię z GetResponse?</AlertDialogTitle>
              <AlertDialogDescription>
                Kampania <strong>{toDelete?.subject ?? toDelete?.name ?? '(bez tytułu)'}</strong> zostanie
                trwale usunięta z GetResponse. Tej operacji nie można cofnąć.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Anuluj</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteMut.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-1 h-4 w-4" />
                )}
                Usuń
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  Briefcase,
  CheckCircle2,
  Clock,
  Copy,
  FileCheck2,
  FileText,
  FileX2,
  MessageSquareText,
  Send,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/Page';
import { DecisionDialog } from '@/components/interpellations/DecisionDialog';
import { DeleteInterpellationDialog } from '@/components/interpellations/DeleteInterpellationDialog';
import { InterpellationDeadline } from '@/components/interpellations/InterpellationDeadline';
import { InterpellationStatusPill } from '@/components/interpellations/InterpellationStatusPill';
import { InterpellationUploadDialog } from '@/components/interpellations/InterpellationUploadDialog';
import { MarkSentDialog } from '@/components/interpellations/MarkSentDialog';
import { DEADLINE_TEXT } from '@/components/interpellations/urgency';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useInterpellation } from '@/hooks/useInterpellations';
import { useMpForms } from '@/hooks/useMpForms';
import { useModuleNarrow } from '@/hooks/useModuleNarrow';
import type { InterpellationDecision, InterpellationWithRelations } from '@/integrations/supabase/types';
import type { MpForms } from '@/lib/mpForms';
import { AWAITING_DECISION, deadlineState } from '@/lib/interpellations';
import { canWrite, isAdmin } from '@/lib/permissions';
import { cn } from '@/lib/utils';


type TimelineItem = {
  label: string;
  at: string;
  detail?: string;
  icon: LucideIcon;
  className?: string;
};

function InterpellationTimeline({ item }: { item: InterpellationWithRelations }) {
  const mp = useMpForms();
  const rows = useMemo<TimelineItem[]>(() => {
    const result: TimelineItem[] = [
      {
        label: item.revision > 1 ? `Wgrano wersję ${item.revision}` : 'Wgrana',
        at: item.submitted_at,
        detail: item.creator?.full_name,
        icon: Upload,
      },
    ];
    if (item.decided_at) {
      result.push({
        label: `Decyzja ${mp.genitive}`,
        at: item.decided_at,
        detail: item.decider?.full_name,
        icon: FileCheck2,
      });
    }
    if (item.accepted_at) {
      result.push({ label: 'Zaakceptowana', at: item.accepted_at, icon: CheckCircle2 });
    }
    if (item.deadline_at) {
      result.push({
        label: 'Termin wysłania',
        at: item.deadline_at,
        icon: Clock,
        className:
          item.status === 'zaakceptowana' ? DEADLINE_TEXT[deadlineState(item.deadline_at)] : undefined,
      });
    }
    if (item.sent_at) result.push({ label: 'Wysłana', at: item.sent_at, icon: Send });
    if (item.archived_at) result.push({ label: 'Archiwum', at: item.archived_at, icon: Archive });
    return result;
  }, [item, mp]);

  return (
    <section className="rounded-xl border bg-card p-4 shadow-card">
      <h2 className="mb-3 text-sm font-semibold">Historia</h2>
      <ol className="space-y-3">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <li key={`${row.label}-${row.at}`} className="flex gap-3 text-sm">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className={cn('font-medium', row.className)}>{row.label}</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(row.at), 'd MMMM yyyy, HH:mm', { locale: pl })}
                  {row.detail && <> · {row.detail}</>}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ReviewNotes({ item }: { item: InterpellationWithRelations }) {
  const mp = useMpForms();
  if (!item.review_notes) return null;
  const waiting = item.status === 'uwagi';
  const rejected = item.status === 'odrzucona';
  // Po poprawkach notatka dotyczy poprzedniej wersji - bez tego wygląda jak nowa uwaga do bieżącej.
  const revised = item.status === 'po_poprawkach';
  return (
    <section
      className={cn(
        'rounded-xl border p-4 shadow-card',
        waiting
          ? 'border-amber-500/30 bg-amber-50 text-amber-950 dark:bg-amber-500/10 dark:text-amber-100'
          : 'bg-card',
      )}
    >
      <div className="flex items-start gap-3">
        <MessageSquareText className={cn('mt-0.5 h-4 w-4 shrink-0', waiting ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')} />
        <div className="min-w-0 space-y-1">
          <h2 className="text-sm font-semibold">
            {waiting
              ? `Uwagi ${mp.genitive}`
              : rejected
                ? 'Powód odrzucenia'
                : revised
                  ? 'Uwagi do poprzedniej wersji'
                  : `Komentarz ${mp.genitive}`}
          </h2>
          {waiting && (
            <p className="text-xs opacity-80">
              Czeka na poprawki pracownika i nową wersję interpelacji.
            </p>
          )}
          {revised && (
            <p className="text-xs text-muted-foreground">
              Wersja {item.revision} uwzględnia poprawki i czeka na decyzję.
            </p>
          )}
          <p className="whitespace-pre-wrap break-words text-sm">{item.review_notes}</p>
        </div>
      </div>
    </section>
  );
}

function stageDescription(item: InterpellationWithRelations, admin: boolean, mp: MpForms): string {
  if (AWAITING_DECISION.includes(item.status)) return admin ? 'Czeka na Twoją decyzję.' : `Czeka na decyzję ${mp.genitive}.`;
  if (item.status === 'uwagi') return 'Czeka na poprawki pracownika i ponowne wgranie.';
  if (item.status === 'zaakceptowana') return 'Zaakceptowana. Czeka na wysłanie.';
  if (item.status === 'wyslana') return 'Wysłana. Obieg zakończony.';
  return 'Odrzucona. Znajduje się w archiwum.';
}

interface ActionPanelProps {
  item: InterpellationWithRelations;
  admin: boolean;
  writer: boolean;
  uploader: boolean;
  onDecision: (decision: InterpellationDecision) => void;
  onMarkSent: () => void;
  onResubmit: () => void;
  className?: string;
}

function ActionPanel({ item, admin, writer, uploader, onDecision, onMarkSent, onResubmit, className }: ActionPanelProps) {
  const awaiting = AWAITING_DECISION.includes(item.status);
  const mp = useMpForms();
  return (
    <section className={cn('rounded-xl border bg-card p-4 shadow-card', className)}>
      <h2 className="text-sm font-semibold">Działania</h2>
      <p className="mt-1 text-xs text-muted-foreground">{stageDescription(item, admin, mp)}</p>

      {admin && awaiting && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:gap-2">
          <Button className="col-span-2" onClick={() => onDecision('zaakceptowana')}>
            <CheckCircle2 />
            Akceptuj
          </Button>
          <Button variant="outline" onClick={() => onDecision('uwagi')}>
            <MessageSquareText />
            Uwagi
          </Button>
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => onDecision('odrzucona')}>
            <Archive />
            Odrzuć
          </Button>
        </div>
      )}

      {uploader && item.status === 'uwagi' && (
        <div className="mt-4">
          <Button className="w-full" onClick={onResubmit}>
            <Upload />
            Wgraj poprawioną wersję
          </Button>
        </div>
      )}

      {writer && item.status === 'zaakceptowana' && (
        <div className="mt-4 space-y-3">
          {item.deadline_at && <InterpellationDeadline deadlineAt={item.deadline_at} />}
          <Button className="w-full" onClick={onMarkSent}>
            <Send />
            Oznacz jako wysłaną
          </Button>
        </div>
      )}
    </section>
  );
}

export default function InterpellationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const admin = isAdmin(profile?.role);
  const writer = canWrite(profile?.role);
  // Poprawioną wersję wgrywa Pracownik (jak narzędzie MCP interpellations_resubmit).
  const uploader = profile?.role === 'pracownik';
  const { data: item, isLoading } = useInterpellation(id ?? null);
  const [contentTab, setContentTab] = useState<'preview' | 'text'>('preview');
  const [decision, setDecision] = useState<InterpellationDecision | null>(null);
  const [markSentOpen, setMarkSentOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const moduleNarrow = useModuleNarrow('md');

  if (isLoading) {
    return (
      <Page>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg @max-md:hidden" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
        <div className="grid gap-5 @lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-[70vh] rounded-xl" />
          <div className="space-y-4">
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      </Page>
    );
  }

  if (!item) {
    return (
      <Page narrow>
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FileX2 className="h-5 w-5" />
          </div>
          <p className="text-sm text-muted-foreground">Nie znaleziono interpelacji lub nie masz do niej dostępu.</p>
          <Button size="sm" asChild>
            <Link to="/biuro/interpelacje">Wróć do listy</Link>
          </Button>
        </div>
      </Page>
    );
  }

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(item.content_text);
      toast.success('Tekst skopiowany do schowka');
    } catch {
      toast.error('Nie udało się skopiować tekstu');
    }
  };
  // Domyślny margines dokumentu (8 px) klei tekst do ramki - margines jak w zakładce "Tekst"; własne style HTML
  // stoją później i go nadpisują. Wąski obszar modułu: obrazy i długie słowa mieszczą się w podglądzie.
  const previewHtml =
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">` +
    (moduleNarrow
      ? '<style>body{margin:1.25rem;overflow-wrap:break-word}img{max-width:100%;height:auto}</style>'
      : '<style>body{margin:1.75rem}</style>') +
    item.content_html;


  return (
    <Page>
      <PageHeader
        // Wąski obszar: bez ikony, żeby długi temat miał pełną szerokość.
        icon={moduleNarrow ? undefined : FileText}
        title={<span className="whitespace-normal break-words">{item.subject}</span>}
        description={
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <InterpellationStatusPill status={item.status} full />
            <span>Odbiorca: <span className="text-foreground">{item.recipient}</span></span>
            <span>wersja {item.revision}</span>
            <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />Autor: {item.creator?.full_name ?? '—'}</span>
            <span>Podpisuje: {item.signatory?.full_name ?? '—'}</span>
            {item.case && (
              <Link
                to={`/biuro/sprawy?open=${encodeURIComponent(item.case.id)}`}
                className="relative z-10 inline-flex items-center gap-1 text-primary hover:underline max-md:min-h-10 @max-md:break-words"
              >
                <Briefcase className="h-3.5 w-3.5 shrink-0" />
                {item.case.title}
              </Link>
            )}
          </span>
        }
      />

      <ReviewNotes item={item} />

      {/* Jedna kolumna: aside rozpada się (contents), żeby panel decyzji był nad treścią, a historia pod nią. */}
      <div className="grid items-start gap-5 @lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-card">
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
            <div role="tablist" aria-label="Treść interpelacji" className="flex rounded-lg bg-muted p-1">
              <button
                type="button"
                role="tab"
                aria-selected={contentTab === 'preview'}
                onClick={() => setContentTab('preview')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-10 max-md:px-4',
                  contentTab === 'preview' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Podgląd
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={contentTab === 'text'}
                onClick={() => setContentTab('text')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-10 max-md:px-4',
                  contentTab === 'text' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Tekst
              </button>
            </div>
            {contentTab === 'text' && (
              <Button variant="outline" size="sm" onClick={copyText}>
                <Copy />
                Kopiuj tekst
              </Button>
            )}
          </div>

          {contentTab === 'preview' ? (
            <iframe
              sandbox=""
              srcDoc={previewHtml}
              title={`Podgląd interpelacji: ${item.subject}`}
              className="h-[70vh] w-full bg-white"
            />
          ) : (
            // Jedna kolumna: tekst w naturalnej wysokości, bez przewijania w przewijanej stronie.
            <div className="p-5 @sm:p-7 @lg:h-[70vh] @lg:overflow-y-auto">
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-foreground">{item.content_text}</pre>
            </div>
          )}
        </section>

        <aside className="space-y-4 @max-lg:contents @max-lg:space-y-0 @lg:sticky @lg:top-20">
          <ActionPanel
            className="@max-lg:order-first"
            item={item}
            admin={admin}
            writer={writer}
            uploader={uploader}
            onDecision={setDecision}
            onMarkSent={() => setMarkSentOpen(true)}
            onResubmit={() => setResubmitOpen(true)}
          />
          <InterpellationTimeline item={item} />
          {/* Trwałe usunięcie z dala od decyzji: pod historią, także na telefonie. */}
          {admin && (
            <Button
              variant="ghost"
              className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 />
              Usuń interpelację
            </Button>
          )}
        </aside>
      </div>

      <DecisionDialog item={item} decision={decision} onClose={() => setDecision(null)} />
      <MarkSentDialog item={markSentOpen ? item : null} onClose={() => setMarkSentOpen(false)} />
      <InterpellationUploadDialog open={resubmitOpen} revise={item} onClose={() => setResubmitOpen(false)} />
      <DeleteInterpellationDialog
        item={deleteOpen ? item : null}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => navigate('/biuro/interpelacje', { replace: true })}
      />
    </Page>
  );
}

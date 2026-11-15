import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Mail, Plus, RefreshCcw, WifiOff } from 'lucide-react';
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
import { useAuth } from '@/contexts/AuthContext';
import { canWrite, isAdmin } from '@/lib/permissions';
import { useGRNewsletters, useGRStatus } from '@/hooks/useGetResponse';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useMpForms } from '@/hooks/useMpForms';
import {
  fetchNewsletterIssueTemplate,
  useNewsletterIssues,
  type NewsletterIssueSummary,
} from '@/hooks/useNewsletterIssues';

import { CampaignsList } from './CampaignsList';
import { NewsletterEditorDialog } from './NewsletterEditorDialog';
import { hasDraft } from './newsletter/draft';

interface Props {
  /** Nagłówek strony (PageHeader) z akcjami widoku. */
  renderHeader: (actions?: ReactNode) => ReactNode;
}

export function KampanieView({ renderHeader }: Props) {
  const { profile } = useAuth();
  const writer = canWrite(profile?.role);
  const isMobile = useIsMobile();
  const mp = useMpForms();

  const statusQ = useGRStatus(true);
  const newslettersQ = useGRNewsletters(statusQ.data?.ok === true);
  const issuesQ = useNewsletterIssues(writer);

  const [editorOpen, setEditorOpen] = useState(false);
  /** Treść wydania wczytana do duplikowania; undefined = zwykły nowy newsletter / szkic. */
  const [duplicateFrom, setDuplicateFrom] = useState<unknown>(undefined);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState<NewsletterIssueSummary | null>(null);

  const issuesByGrId = useMemo(
    () =>
      Object.fromEntries(
        (issuesQ.data ?? []).filter((i) => i.gr_newsletter_id).map((i) => [i.gr_newsletter_id as string, i]),
      ),
    [issuesQ.data],
  );

  const openNew = () => {
    if (isMobile) return;
    setDuplicateFrom(undefined);
    setEditorOpen(true);
  };

  const duplicate = async (issue: NewsletterIssueSummary) => {
    if (isMobile) return;
    setConfirmReplace(null);
    setDuplicatingId(issue.id);
    try {
      setDuplicateFrom(await fetchNewsletterIssueTemplate(issue.id));
      setEditorOpen(true);
    } catch (err) {
      toast.error('Nie udało się wczytać wydania', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    } finally {
      setDuplicatingId(null);
    }
  };

  const requestDuplicate = (issue: NewsletterIssueSummary) => {
    if (profile?.id && hasDraft(profile.id)) setConfirmReplace(issue);
    else void duplicate(issue);
  };

  const isUnconfigured =
    statusQ.error?.message?.includes('GR_NOT_CONFIGURED') ||
    (statusQ.error as Error & { code?: string })?.code === 'GR_NOT_CONFIGURED' ||
    statusQ.error?.message?.includes('nie jest skonfigurowany');

  // Brak konfiguracji - empty state z linkiem do admin panelu
  if (statusQ.isError && isUnconfigured) {
    const isPosel = isAdmin(profile?.role);
    return (
      <>
        {renderHeader()}
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="max-w-md space-y-1">
            <p className="text-base font-medium">Integracja GetResponse nie jest skonfigurowana</p>
            <p className="text-sm text-muted-foreground">
              {isMobile
                ? 'Integrację GetResponse można skonfigurować na komputerze.'
                : isPosel
                  ? 'Wpisz klucz API GetResponse w panelu administratora, żeby móc tworzyć i wysyłać kampanie.'
                  : `Skontaktuj się z ${mp.instrumental} lub Administratorem - musi wpisać klucz API GetResponse w panelu administratora.`}
            </p>
          </div>
          {isPosel && (
            <Button asChild className="max-md:hidden">
              <Link to="/biuro/admin/integracje/getresponse">
                <Mail />
                Konfiguruj GetResponse
              </Link>
            </Button>
          )}
        </div>
      </>
    );
  }

  // Inny blad polaczenia
  if (statusQ.isError && !isUnconfigured) {
    return (
      <>
        {renderHeader()}
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-12 text-center shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <WifiOff className="h-5 w-5" />
          </div>
          <div className="max-w-md space-y-1">
            <p className="font-medium">Błąd połączenia z GetResponse</p>
            <p className="break-words text-sm text-muted-foreground">{statusQ.error?.message}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => statusQ.refetch()}>
            <RefreshCcw />
            Spróbuj ponownie
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {renderHeader(
        writer && (
          <Button className="max-md:hidden" onClick={openNew} disabled={statusQ.data?.ok !== true}>
            <Plus />
            Nowa kampania
          </Button>
        ),
      )}

      <p className="text-[13px] text-muted-foreground">
        Historia wysyłek z GetResponse.{' '}
        {writer && !isMobile && 'Wydania wysłane z ePosła mają wersję online i można je zduplikować jako punkt wyjścia.'}
      </p>

      <CampaignsList
        newsletters={newslettersQ.data ?? []}
        isLoading={newslettersQ.isLoading}
        error={newslettersQ.error}
        onCreate={writer && !isMobile && statusQ.data?.ok === true ? openNew : undefined}
        issuesByGrId={issuesByGrId}
        onDuplicate={writer && !isMobile && statusQ.data?.ok === true ? requestDuplicate : undefined}
        duplicatingId={duplicatingId}
        readOnly={isMobile}
      />

      {!isMobile && (
        <>
          <NewsletterEditorDialog open={editorOpen} onClose={() => setEditorOpen(false)} duplicateFrom={duplicateFrom} />

          <AlertDialog open={confirmReplace !== null} onOpenChange={(o) => !o && setConfirmReplace(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Zastąpić niedokończony szkic?</AlertDialogTitle>
                <AlertDialogDescription>
                  Masz zapisany szkic newslettera. Kopia wydania „{confirmReplace?.subject}” zastąpi go — szkicu nie
                  będzie można przywrócić.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Anuluj</AlertDialogCancel>
                <AlertDialogAction onClick={() => confirmReplace && void duplicate(confirmReplace)}>
                  Zastąp szkicem z kopii
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </>
  );
}

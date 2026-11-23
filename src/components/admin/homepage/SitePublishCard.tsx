import { useEffect, useState, type FormEvent } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { pl } from 'date-fns/locale';
import { ExternalLink, Globe, Loader2, Rocket, Save } from 'lucide-react';
import { toast } from 'sonner';

import { ErrorNotice, SettingsCard, StatusPill } from '@/components/admin/AdminUi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  normalizePublicSiteUrl,
  usePublicSiteUrl,
  useSitePublishAction,
  useSitePublishStatus,
  useUpdatePublicSiteUrl,
  type SitePublishJob,
} from '@/hooks/useSitePublish';

const URL_FIELD_ID = 'public-site-url';

const REASON_LABEL: Record<SitePublishJob['reason'], string> = {
  manual: 'ręczna',
  newsletter: 'newsletter',
  daily: 'codzienna',
};

/** Kody błędów z generatora (service_site_publisher_finish) w zrozumiałej formie. */
const ERROR_LABEL: Record<string, string> = {
  timeout: 'przekroczony czas publikacji',
  failed: 'błąd publikacji',
};

const dateTime = (iso: string) => format(new Date(iso), "d MMM yyyy, 'godz.' HH:mm", { locale: pl });

function PublicSiteUrlForm({ current }: { current: string }) {
  const updateMut = useUpdatePublicSiteUrl();
  const [value, setValue] = useState(current);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => setValue(current), [current]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizePublicSiteUrl(value);
    if (normalized === null) {
      setProblem('Adres musi mieć postać https://domena (np. https://jan-kowalski.pl), bez ścieżki.');
      return;
    }
    setProblem(null);
    try {
      await updateMut.mutateAsync(normalized);
      setValue(normalized);
      toast.success(normalized ? 'Adres strony posła zapisany' : 'Adres strony posła usunięty', {
        description: normalized
          ? 'Wersje online newslettera i obrazy w mailach będą prowadzić na stronę posła.'
          : 'Stronę główną i wersje online newslettera serwuje portal.',
      });
    } catch (err) {
      toast.error('Nie udało się zapisać adresu strony', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const dirty = value.trim().replace(/\/+$/, '').toLowerCase() !== current;
  const describedBy = problem ? `${URL_FIELD_ID}-error` : `${URL_FIELD_ID}-hint`;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-1.5">
      <Label htmlFor={URL_FIELD_ID}>Adres strony posła</Label>
      <div className="flex flex-col gap-2 @sm:flex-row">
        <Input
          id={URL_FIELD_ID}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://jan-kowalski.pl"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={problem ? true : undefined}
          aria-describedby={describedBy}
        />
        <Button type="submit" variant="outline" disabled={!dirty || updateMut.isPending} className="shrink-0">
          {updateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Zapisz adres
        </Button>
      </div>
      {problem ? (
        <p id={`${URL_FIELD_ID}-error`} className="text-xs text-destructive">
          {problem}
        </p>
      ) : (
        <p id={`${URL_FIELD_ID}-hint`} className="text-xs text-muted-foreground">
          Domena statycznej strony posła (serwer biura). Puste pole = stronę główną serwuje portal, a wersje
          online newslettera są pod adresem portalu.
        </p>
      )}
    </form>
  );
}

/** Karta „Publikacja strony”: adres strony posła, stan ostatniej publikacji, przycisk publikacji. */
export function SitePublishCard() {
  const urlQ = usePublicSiteUrl();
  const siteUrl = urlQ.data ?? '';
  const statusQ = useSitePublishStatus(Boolean(siteUrl));
  const { publish, pending: requesting } = useSitePublishAction();

  const status = statusQ.data;
  const pendingJob = status?.pending[0] ?? null;
  const last = status?.last ?? null;
  const lastFailed = last?.status === 'failed' ? last : null;

  const actions = siteUrl ? (
    <>
      <Button asChild variant="ghost" size="sm">
        <a href={siteUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-4 w-4" />
          Otwórz stronę
        </a>
      </Button>
      <Button size="sm" onClick={() => void publish()} disabled={requesting || Boolean(pendingJob) || !status}>
        {requesting || pendingJob ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
        {pendingJob ? 'Publikacja w toku' : 'Opublikuj stronę'}
      </Button>
    </>
  ) : undefined;

  return (
    <SettingsCard
      icon={Globe}
      title="Publikacja strony"
      description={
        siteUrl
          ? 'Strona posła jest statyczna: zmiany treści, wpisy bloga i wydarzenia trafiają na nią po publikacji. Serwer biura publikuje ją też codziennie rano.'
          : 'Stronę główną serwuje portal - zmiany są widoczne od razu po zapisie, bez publikacji.'
      }
      actions={actions}
    >
      <div className="space-y-4">
        {urlQ.error ? (
          <ErrorNotice title="Błąd odczytu adresu strony" message={urlQ.error.message} />
        ) : (
          urlQ.isSuccess && <PublicSiteUrlForm current={siteUrl} />
        )}

        {siteUrl && statusQ.error && (
          <ErrorNotice title="Błąd odczytu stanu publikacji" message={statusQ.error.message} />
        )}

        {siteUrl && status && (
          <dl className="grid gap-3 text-sm @md:grid-cols-2">
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">Ostatnia udana publikacja</dt>
              <dd>
                {status.last_ok_at ? (
                  <span title={dateTime(status.last_ok_at)}>
                    {formatDistanceToNow(new Date(status.last_ok_at), { locale: pl, addSuffix: true })}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Strona nie była jeszcze publikowana</span>
                )}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">Stan</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {pendingJob ? (
                  <StatusPill tone="info" icon={<Loader2 className="h-3 w-3 animate-spin" />}>
                    {pendingJob.status === 'running' ? 'Publikowanie…' : 'W kolejce'} ({REASON_LABEL[pendingJob.reason]})
                  </StatusPill>
                ) : lastFailed ? (
                  <StatusPill tone="danger">Ostatnia publikacja nieudana</StatusPill>
                ) : last ? (
                  <StatusPill tone="success">Opublikowana</StatusPill>
                ) : (
                  <StatusPill tone="neutral">Brak publikacji</StatusPill>
                )}
              </dd>
            </div>
            {lastFailed && !pendingJob && (
              <div className="@md:col-span-2">
                <ErrorNotice
                  title={`Publikacja z ${dateTime(lastFailed.finished_at ?? lastFailed.requested_at)} nie powiodła się`}
                  message={`${ERROR_LABEL[lastFailed.error ?? 'failed'] ?? `kod błędu: ${lastFailed.error}`}. Spróbuj ponownie; jeśli błąd się powtarza, sprawdź konsolę serwera biura.`}
                />
              </div>
            )}
          </dl>
        )}
      </div>
    </SettingsCard>
  );
}

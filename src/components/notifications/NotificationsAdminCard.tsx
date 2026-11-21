import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  Save,
  Send,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ErrorNotice, SettingsCard, SettingsCardSkeleton, StatusPill, type PillTone } from '@/components/admin/AdminUi';
import {
  testErrorMessage,
  useNotificationsAdminStatus,
  useSaveNotificationsSettings,
  useSaveResendKey,
  useSendTestNotification,
} from '@/hooks/useNotifications';
import { useSecretSettingsStatus } from '@/hooks/useSecretSettings';
import { INSTANCE } from '@/lib/instance';
import type { NotificationsAdminStatus, NotificationsSettings } from '@/lib/notifications';

const EMAIL_DISABLED_TEXT = 'Wysyłka e-mail jest wyłączona przez operatora instancji';

const RESEND_KEYS_URL = 'https://resend.com/api-keys';
const RESEND_DOMAINS_URL = 'https://resend.com/domains';

const DOMAIN_TONE: Record<string, PillTone> = { verified: 'success', pending: 'warning' };
const DOMAIN_LABEL: Record<string, string> = {
  verified: 'Zweryfikowana',
  pending: 'Oczekuje',
  not_started: 'Niezweryfikowana',
  failed: 'Błąd weryfikacji',
  temporary_failure: 'Błąd weryfikacji',
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Nieznany błąd';
}

// ---------------------------------------------------------------------------
// Resend: klucz API

/** Stan połączenia z Resend (wynik sprawdzenia klucza w op=admin_status). */
function ResendStatusBadge({
  hasKey,
  isLoading,
  error,
  resend,
}: {
  hasKey: boolean;
  isLoading: boolean;
  error: Error | null;
  resend: NotificationsAdminStatus['resend'] | undefined;
}) {
  if (!hasKey) return <StatusPill tone="neutral">Brak klucza</StatusPill>;
  if (isLoading) {
    return (
      <StatusPill tone="warning" icon={<Loader2 className="h-3 w-3 animate-spin" />}>
        Sprawdzam...
      </StatusPill>
    );
  }
  if (error || resend?.ok === false) {
    return (
      <StatusPill tone="danger" title={error?.message ?? resend?.message} icon={<XCircle className="h-3 w-3" />}>
        Błąd
      </StatusPill>
    );
  }
  if (resend?.ok) {
    return (
      <StatusPill tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>
        Połączono
      </StatusPill>
    );
  }
  return null;
}

/** Klucz Resend; przy INSTANCE_EMAIL=off tylko informacja (bez zapytań o klucz i Resend). */
export function ResendKeyCard() {
  if (!INSTANCE.email) return <EmailDisabledCard />;
  return <ResendKeyConfig />;
}

function EmailDisabledCard() {
  return (
    <SettingsCard
      icon={Mail}
      title="E-mail"
      description={`${EMAIL_DISABLED_TEXT}.`}
      actions={<StatusPill tone="neutral">Wyłączone</StatusPill>}
    >
      <p className="text-xs text-muted-foreground">
        Powiadomienia trafiają do użytkowników tylko jako push. Włączenie e-maili wymaga zmiany konfiguracji
        wdrożenia przez operatora.
      </p>
    </SettingsCard>
  );
}

function ResendKeyConfig() {
  const secretsQ = useSecretSettingsStatus();
  const adminQ = useNotificationsAdminStatus();
  const saveKeyMut = useSaveResendKey();
  const [newKey, setNewKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const keyStatus = secretsQ.data?.resend_api_key;
  const hasKey = keyStatus?.configured === true;
  const resend = adminQ.data?.resend;

  const saveKey = async (value: string | null) => {
    try {
      await saveKeyMut.mutateAsync(value);
      setNewKey('');
      setShowKey(false);
      toast.success(value ? 'Klucz Resend zapisany' : 'Klucz Resend usunięty');
    } catch (err) {
      toast.error(value ? 'Nie udało się zapisać klucza' : 'Nie udało się usunąć klucza', {
        description: errorText(err),
      });
    }
  };

  if (secretsQ.error) return <ErrorNotice title="Błąd odczytu konfiguracji" message={secretsQ.error.message} />;
  if (secretsQ.isLoading) return <SettingsCardSkeleton label="Ładuję konfigurację Resend..." fields={1} />;

  return (
    <SettingsCard
      icon={KeyRound}
      title="Resend (e-mail)"
      description="Usługa wysyłki e-maili z powiadomieniami."
      actions={
        <ResendStatusBadge hasKey={hasKey} isLoading={adminQ.isLoading} error={adminQ.error} resend={resend} />
      }
      footer={
        <Button onClick={() => void saveKey(newKey)} disabled={saveKeyMut.isPending || !newKey.trim()}>
          {saveKeyMut.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          Zapisz klucz
        </Button>
      }
    >
      <div className="space-y-5">
        <ol className="space-y-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          <li>
            <strong className="text-foreground">1.</strong> Zweryfikuj domenę nadawcy:{' '}
            <ExtLink href={RESEND_DOMAINS_URL}>resend.com → Domains</ExtLink>.
          </li>
          <li>
            <strong className="text-foreground">2.</strong> Utwórz klucz:{' '}
            <ExtLink href={RESEND_KEYS_URL}>resend.com → API Keys</ExtLink> (wystarczy uprawnienie{' '}
            <strong>Sending access</strong>).
          </li>
          <li>
            <strong className="text-foreground">3.</strong> Wklej klucz poniżej i zapisz, potem uzupełnij adres nadawcy.
          </li>
        </ol>

        <div className="space-y-1.5">
          <Label htmlFor="resend-api-key">Klucz API Resend</Label>
          {hasKey && (
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
              <span>
                Zapisany klucz: <code className="font-mono text-foreground">{keyStatus?.hint ?? '••••'}</code>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-destructive hover:text-destructive"
                onClick={() => void saveKey(null)}
                disabled={saveKeyMut.isPending}
              >
                Usuń klucz
              </Button>
            </div>
          )}
          <div className="relative">
            <Input
              id="resend-api-key"
              type={showKey ? 'text' : 'password'}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder={hasKey ? 'Wklej nowy klucz, aby zastąpić zapisany' : 're_...'}
              autoComplete="off"
              className="pr-10 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-muted-foreground hover:text-foreground"
              aria-label={showKey ? 'Ukryj klucz' : 'Pokaż klucz'}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Zapisany klucz nie jest odczytywany przez przeglądarkę (widać tylko jego końcówkę).
          </p>
        </div>

        {resend?.ok === false && (
          <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {resend.message ?? 'Resend odrzucił klucz.'}
              {resend.code && <code className="ml-1 font-mono opacity-80">({resend.code})</code>}
            </p>
          </div>
        )}

        {resend?.ok && resend.domains && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Domeny</p>
            {resend.domains.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Brak domen. Dodaj i zweryfikuj domenę w <ExtLink href={RESEND_DOMAINS_URL}>resend.com</ExtLink>.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {resend.domains.map((d) => (
                  <li key={d.name} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate font-mono text-[13px]">{d.name}</span>
                    <StatusPill tone={DOMAIN_TONE[d.status] ?? 'danger'}>{DOMAIN_LABEL[d.status] ?? d.status}</StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {resend?.ok && !resend.domains && (
          <p className="text-xs text-muted-foreground">
            Klucz ma tylko uprawnienie do wysyłki, więc lista domen nie jest dostępna.
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

// ---------------------------------------------------------------------------
// Nadawca i ustawienia instancji

export function NotificationsSettingsCard() {
  const adminQ = useNotificationsAdminStatus();
  const saveMut = useSaveNotificationsSettings();
  const testMut = useSendTestNotification();
  const [form, setForm] = useState<NotificationsSettings | null>(null);

  useEffect(() => {
    if (adminQ.data && !form) setForm(adminQ.data.settings);
  }, [adminQ.data, form]);

  if (adminQ.error) {
    return <ErrorNotice title="Błąd odczytu ustawień powiadomień" message={adminQ.error.message} />;
  }
  if (adminQ.isLoading || !form) return <SettingsCardSkeleton label="Ładuję ustawienia powiadomień..." fields={4} />;

  const set = <K extends keyof NotificationsSettings>(key: K, value: NotificationsSettings[K]) =>
    setForm({ ...form, [key]: value });

  const handleSave = async () => {
    try {
      const { settings } = await saveMut.mutateAsync({
        ...form,
        from_email: form.from_email.trim(),
        from_name: form.from_name.trim(),
        reply_to: form.reply_to.trim(),
        app_url: form.app_url.trim(),
      });
      setForm(settings);
      toast.success('Ustawienia powiadomień zapisane');
    } catch (err) {
      toast.error('Nie udało się zapisać ustawień', { description: errorText(err) });
    }
  };

  const sendTest = () =>
    testMut.mutate('email', {
      onSuccess: () => toast.success('Wysłano wiadomość testową na Twój adres'),
      onError: (err) => toast.error('Nie udało się wysłać testu', { description: testErrorMessage(err) }),
    });

  const domain = form.from_email.split('@')[1]?.toLowerCase();
  const domains = adminQ.data?.resend?.domains;
  const domainUnverified =
    Boolean(domain) && domains !== undefined && !domains.some((d) => d.name.toLowerCase() === domain && d.status === 'verified');
  const dirty = JSON.stringify(form) !== JSON.stringify(adminQ.data?.settings);
  const emailOn = INSTANCE.email;

  return (
    <SettingsCard
      icon={SlidersHorizontal}
      title={emailOn ? 'Nadawca i ustawienia' : 'Ustawienia'}
      description={
        emailOn
          ? 'Adres nadawcy, linki w wiadomościach i kanały włączone w biurze.'
          : 'Linki w powiadomieniach i powiadomienia push w biurze.'
      }
      footer={
        <>
          {emailOn && (
            <Button
              type="button"
              variant="outline"
              onClick={sendTest}
              disabled={testMut.isPending || dirty || !form.email_enabled}
              title={dirty ? 'Najpierw zapisz zmiany' : undefined}
            >
              {testMut.isPending ? <Loader2 className="animate-spin" /> : <Send />}
              Wyślij test e-mail do mnie
            </Button>
          )}
          <Button onClick={() => void handleSave()} disabled={saveMut.isPending || !dirty}>
            {saveMut.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            Zapisz
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 @md:grid-cols-2">
          {emailOn && (
            <>
              <Field id="notif-from-email" label="Adres nadawcy" hint="W domenie zweryfikowanej w Resend.">
                <Input
                  id="notif-from-email"
                  type="email"
                  value={form.from_email}
                  onChange={(e) => set('from_email', e.target.value)}
                  placeholder="powiadomienia@twojadomena.pl"
                  autoComplete="off"
                />
              </Field>
              <Field id="notif-from-name" label="Nazwa nadawcy">
                <Input
                  id="notif-from-name"
                  value={form.from_name}
                  onChange={(e) => set('from_name', e.target.value)}
                  placeholder="Biuro Poselskie"
                />
              </Field>
              <Field id="notif-reply-to" label="Adres do odpowiedzi" hint="Opcjonalnie. Puste = odpowiedzi do nadawcy.">
                <Input
                  id="notif-reply-to"
                  type="email"
                  value={form.reply_to}
                  onChange={(e) => set('reply_to', e.target.value)}
                  placeholder="biuro@twojadomena.pl"
                  autoComplete="off"
                />
              </Field>
            </>
          )}
          <Field id="notif-app-url" label="Adres portalu" hint="Do linków w wiadomościach. Puste = bieżący adres.">
            <Input
              id="notif-app-url"
              type="url"
              value={form.app_url}
              onChange={(e) => set('app_url', e.target.value)}
              placeholder={window.location.origin}
              autoComplete="off"
            />
          </Field>
        </div>

        {emailOn && domainUnverified && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            Domena <code className="font-mono">{domain}</code> nie jest zweryfikowana w Resend. Wiadomości nie zostaną
            wysłane.
          </p>
        )}

        {!emailOn && (
          <p className="flex items-start gap-1.5 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Mail className="mt-px h-3.5 w-3.5 shrink-0" />
            {EMAIL_DISABLED_TEXT}. Zapisane ustawienia e-mail są zachowane, ale nieużywane.
          </p>
        )}

        <div className="divide-y rounded-lg border">
          {emailOn && (
            <ToggleRow
              id="notif-email-enabled"
              title="Wysyłka e-mail"
              description="Powiadomienia i podsumowania e-mailem przez Resend."
              checked={form.email_enabled}
              onChange={(v) => set('email_enabled', v)}
            />
          )}
          <ToggleRow
            id="notif-push-enabled"
            title="Powiadomienia push"
            description="Na telefonach i komputerach, na których użytkownicy je włączą."
            checked={form.push_enabled}
            onChange={(v) => set('push_enabled', v)}
          />
          {emailOn && (
            <ToggleRow
              id="notif-include-titles"
              title="Tytuły spraw i wydarzeń w treści e-maili"
              description="Wyłączone: e-mail zawiera tylko rodzaj zdarzenia i link. Push nigdy nie zawiera tytułów."
              checked={form.include_titles}
              onChange={(v) => set('include_titles', v)}
            />
          )}
        </div>
      </div>
    </SettingsCard>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({
  id,
  title,
  description,
  checked,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium leading-snug">
          {title}
        </label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stan wysyłki

export function DispatchStatusCard() {
  const adminQ = useNotificationsAdminStatus();
  const data: NotificationsAdminStatus | undefined = adminQ.data;
  if (adminQ.error) return null;
  if (!data) return <SettingsCardSkeleton label="Ładuję stan wysyłki..." fields={1} />;

  const instant = data.dispatch.registered && data.dispatch.pg_net;
  const stats: { label: string; value: number; tone?: string }[] = [
    { label: 'W kolejce', value: data.stats.pending },
    { label: 'Błędy (24 h)', value: data.stats.failed_24h, tone: data.stats.failed_24h > 0 ? 'text-destructive' : undefined },
    { label: 'Wysłane (7 dni)', value: data.stats.sent_7d },
  ];

  return (
    <SettingsCard
      icon={Activity}
      title="Stan wysyłki"
      actions={
        instant ? (
          <StatusPill tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>
            Natychmiastowa
          </StatusPill>
        ) : (
          <StatusPill tone="warning">Raz dziennie</StatusPill>
        )
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-3 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border bg-muted/30 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{s.label}</dt>
              <dd className={`text-lg font-semibold tabular-nums ${s.tone ?? ''}`}>{s.value}</dd>
            </div>
          ))}
        </dl>
        {!instant && (
          <p className="flex items-start gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-300">
            <Mail className="mt-px h-3.5 w-3.5 shrink-0" />
            Powiadomienia natychmiastowe wymagają zapisania ustawień (adres portalu); w przeciwnym razie wysyłka
            raz dziennie.
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

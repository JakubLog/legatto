import { useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Loader2, Mail, Save, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ErrorNotice, SettingsCard, SettingsCardSkeleton, StatusPill } from '@/components/admin/AdminUi';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchSelect } from '@/components/ui/search-select';

import {
  useGetResponseSettings,
  useUpdateGetResponseSettings,
  useGRStatus,
  useGRCampaigns,
  useGRFromFields,
  type GetResponseSettings,
} from '@/hooks/useGetResponse';
import { useSecretSettingsStatus } from '@/hooks/useSecretSettings';

export function GetResponseSettingsCard() {
  const settingsQ = useGetResponseSettings();
  const secretsQ = useSecretSettingsStatus();
  const updateMut = useUpdateGetResponseSettings();
  const [form, setForm] = useState<GetResponseSettings | null>(null);
  // Nowy klucz wpisany przez Posła; zapisany klucz nigdy nie wraca do przeglądarki.
  const [newKey, setNewKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  // Hydruj formularz z odpowiedzi
  useEffect(() => {
    if (settingsQ.data && !form) {
      setForm(settingsQ.data);
    }
  }, [settingsQ.data, form]);

  // Status klucza i listy z GR API (warunkowo - tylko gdy klucz jest ZAPISANY w DB).
  // hasKey opiera sie na statusie z DB (get_secret_settings_status), nie na lokalnym polu -
  // Edge Function odczytuje klucz z DB przez service_role, wiec sprawdzanie statusu
  // przed zapisaniem zwracaloby 409 GR_NOT_CONFIGURED.
  const keyStatus = secretsQ.data?.getresponse_api_key;
  const hasKey = keyStatus?.configured === true;
  const statusQ = useGRStatus(hasKey);
  const campaignsQ = useGRCampaigns(hasKey && statusQ.data?.ok === true);
  const fromFieldsQ = useGRFromFields(hasKey && statusQ.data?.ok === true);

  // Czy lokalny formularz ma klucz, ktory jeszcze nie poszedl do DB
  const hasUnsavedKey = Boolean(newKey.trim());

  const updateField = <K extends keyof GetResponseSettings>(field: K, value: GetResponseSettings[K]) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSave = async () => {
    if (!form) return;
    try {
      await updateMut.mutateAsync({ ...form, api_key: newKey.trim() ? newKey : undefined });
      setNewKey('');
      setShowKey(false);
      toast.success('Konfiguracja GetResponse zapisana');
    } catch (err) {
      toast.error('Nie udało się zapisać konfiguracji', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const handleRemoveKey = async () => {
    try {
      await updateMut.mutateAsync({ api_key: null });
      setNewKey('');
      toast.success('Klucz API GetResponse usunięty');
    } catch (err) {
      toast.error('Nie udało się usunąć klucza', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const loadError = settingsQ.error ?? secretsQ.error;
  if (loadError) {
    return (
      <ErrorNotice title="Błąd odczytu konfiguracji" message={loadError.message} />
    );
  }

  if (settingsQ.isLoading || secretsQ.isLoading || !form) {
    return <SettingsCardSkeleton label="Ładuje konfigurację..." fields={4} />;
  }

  return (
    <SettingsCard
      icon={Mail}
      title="Konto GetResponse"
      description="Klucz API, domyślna lista odbiorców i adres nadawcy kampanii."
      actions={
        <StatusBadge
          hasKey={hasKey}
          isLoading={statusQ.isLoading}
          ok={statusQ.data?.ok}
          error={statusQ.error}
        />
      }
      footer={
        <Button onClick={handleSave} disabled={updateMut.isPending}>
          {updateMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Zapisz
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="gr-api-key">Klucz API GetResponse</Label>
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
                onClick={() => void handleRemoveKey()}
                disabled={updateMut.isPending}
              >
                Usuń klucz
              </Button>
            </div>
          )}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="gr-api-key"
                type={showKey ? 'text' : 'password'}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder={hasKey ? 'Wklej nowy klucz, aby zastąpić zapisany' : 'np. abc123def456...'}
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
          </div>
          <p className="text-xs text-muted-foreground">
            Wygeneruj w GetResponse: <strong>Ustawienia &rarr; Integracje i API &rarr; API</strong>.
            Zapisany klucz nie jest odczytywany przez przeglądarkę (widać tylko jego końcówkę).
          </p>
          {hasUnsavedKey && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Klucz nie jest jeszcze zapisany. Kliknij <strong>Zapisz</strong>, żeby aplikacja
              mogła sprawdzić połączenie z GetResponse i pobrać listy odbiorców.
            </p>
          )}
        </div>

        {statusQ.data?.ok && statusQ.data.account && (
          <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="font-medium text-foreground">Połączono z kontem GetResponse</p>
              <p className="mt-1 text-muted-foreground">
                {statusQ.data.account.company_name ?? '(brak nazwy firmy)'} &middot;{' '}
                {statusQ.data.account.email ?? '(brak email)'}
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-4 @md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="gr-list">Domyślna lista (campaign)</Label>
            <SearchSelect
              id="gr-list"
              value={form.default_list_id || null}
              onChange={(v) => updateField('default_list_id', v ?? '')}
              disabled={!campaignsQ.data || campaignsQ.data.length === 0}
              loading={campaignsQ.isLoading}
              noneLabel="(brak)"
              placeholder={
                campaignsQ.isLoading
                  ? 'Ładuje listy...'
                  : !hasKey
                    ? 'Najpierw wpisz klucz API'
                    : 'Wybierz listę'
              }
              options={(campaignsQ.data ?? []).map((c) => ({ value: c.campaignId, label: c.name }))}
            />
            {form.default_list_id && (
              <p className="text-xs text-muted-foreground">ID: <code className="rounded bg-muted px-1 py-0.5">{form.default_list_id}</code></p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gr-from-field">Adres nadawcy (from-field)</Label>
            <SearchSelect
              id="gr-from-field"
              value={form.from_field_id || null}
              onChange={(v) => {
                if (!v) {
                  updateField('from_field_id', '');
                  return;
                }
                updateField('from_field_id', v);
                const ff = fromFieldsQ.data?.find((f) => f.fromFieldId === v);
                if (ff) {
                  updateField('from_email', ff.email);
                  if (!form.from_name) updateField('from_name', ff.name);
                }
              }}
              disabled={!fromFieldsQ.data || fromFieldsQ.data.length === 0}
              loading={fromFieldsQ.isLoading}
              noneLabel="(brak)"
              placeholder={
                fromFieldsQ.isLoading
                  ? 'Ładuje adresy...'
                  : !hasKey
                    ? 'Najpierw wpisz klucz API'
                    : 'Wybierz adres'
              }
              options={(fromFieldsQ.data ?? []).map((f) => ({
                value: f.fromFieldId,
                label: `${f.name} (${f.email})`,
              }))}
            />
          </div>
        </div>

        <div className="grid gap-4 @md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="gr-from-name">Nazwa nadawcy (display)</Label>
            <Input
              id="gr-from-name"
              value={form.from_name}
              onChange={(e) => updateField('from_name', e.target.value)}
              placeholder="np. Jan Kowalski"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gr-reply-to">Reply-to (opcjonalne)</Label>
            <Input
              id="gr-reply-to"
              type="email"
              value={form.reply_to_email}
              onChange={(e) => updateField('reply_to_email', e.target.value)}
              placeholder="np. biuro@example.pl"
            />
            <p className="text-xs text-muted-foreground">
              Jeśli ustawione, wymaga osobnego from-field-id w GetResponse. Zostaw puste &mdash;
              odpowiedzi trafią na adres nadawcy.
            </p>
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}

function StatusBadge({
  hasKey,
  isLoading,
  ok,
  error,
}: {
  hasKey: boolean;
  isLoading: boolean;
  ok: boolean | undefined;
  error: Error | null;
}) {
  if (!hasKey) {
    return <StatusPill tone="neutral">Nieskonfigurowane</StatusPill>;
  }
  if (isLoading) {
    return (
      <StatusPill tone="warning" icon={<Loader2 className="h-3 w-3 animate-spin" />}>Sprawdzam...</StatusPill>
    );
  }
  if (error || ok === false) {
    return (
      <StatusPill tone="danger" title={error?.message} icon={<XCircle className="h-3 w-3" />}>Błąd</StatusPill>
    );
  }
  if (ok === true) {
    return (
      <StatusPill tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>Połączono</StatusPill>
    );
  }
  return null;
}

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Save,
  ServerCog,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ErrorNotice, SettingsCard, SettingsCardSkeleton, StatusPill } from '@/components/admin/AdminUi';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchSelect } from '@/components/ui/search-select';

import {
  useAiConnection,
  useAiSettings,
  useUpdateAiSettings,
  type AiConnection,
} from '@/hooks/useAi';
import { useSecretSettingsStatus } from '@/hooks/useSecretSettings';

const CLAUDE_BILLING_URL = 'https://claude.ai/settings/billing';
const CONSOLE_KEYS_URL = 'https://platform.claude.com/settings/keys';

interface AiForm {
  model: string;
  /** Nowy klucz wpisany przez Posła; zapisany klucz nigdy nie wraca do przeglądarki. */
  newKey: string;
}

export function AiSettingsCard() {
  const settingsQ = useAiSettings();
  const secretsQ = useSecretSettingsStatus();
  const updateMut = useUpdateAiSettings();
  const [form, setForm] = useState<AiForm | null>(null);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (settingsQ.data && !form) setForm({ model: settingsQ.data.model, newKey: '' });
  }, [settingsQ.data, form]);

  // Serwer czyta klucz z env operatora albo z Vault, więc weryfikacja ma sens dopiero po zapisaniu.
  const keyStatus = secretsQ.data?.anthropic_api_key;
  const hasKey = keyStatus?.configured === true;
  const connectionQ = useAiConnection();
  const connection = connectionQ.data;
  // Błąd zapytania (np. brak uprawnień) = panel jak bez operatora; serwer i tak wybiera env.
  const operatorKey = connection?.operator_managed.key === true;
  const operatorModel = connection?.operator_managed.model === true;
  const hasUnsavedKey = Boolean(form?.newKey.trim());

  const handleSave = async () => {
    if (!form) return;
    try {
      await updateMut.mutateAsync({
        model: operatorModel ? undefined : form.model,
        api_key: form.newKey.trim() ? form.newKey : undefined,
      });
      setForm({ ...form, newKey: '' });
      setShowKey(false);
      toast.success('Konfiguracja AI zapisana');
    } catch (err) {
      toast.error('Nie udało się zapisać konfiguracji', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const handleRemoveKey = async () => {
    if (!form) return;
    try {
      await updateMut.mutateAsync({ model: operatorModel ? undefined : form.model, api_key: null });
      setForm({ ...form, newKey: '' });
      toast.success('Klucz API Claude usunięty');
    } catch (err) {
      toast.error('Nie udało się usunąć klucza', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const loadError = settingsQ.error ?? secretsQ.error;
  if (loadError) {
    return <ErrorNotice title="Błąd odczytu konfiguracji" message={loadError.message} />;
  }

  if (settingsQ.isLoading || secretsQ.isLoading || connectionQ.isLoading || !form) {
    return <SettingsCardSkeleton label="Ładuję konfigurację AI..." fields={2} />;
  }

  const models = connection?.ok ? connection.models : [];
  // Zapisany model zawsze na liście, nawet gdy Anthropic go już nie zwraca.
  const modelOptions = models.some((m) => m.id === form.model)
    ? models
    : [{ id: form.model, display_name: form.model }, ...models];

  return (
    <SettingsCard
      icon={Sparkles}
      title="Claude API"
      description="Klucz i model dla asystenta PoliAI, raportów AI budżetu i odczytu załączników. Interpelacje nie zużywają tego klucza."
      actions={
        <AiStatusBadge isLoading={connectionQ.isLoading} connection={connection} error={connectionQ.error} />
      }
      footer={
        operatorKey && operatorModel ? undefined : (
          <Button onClick={handleSave} disabled={updateMut.isPending}>
            {updateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Zapisz
          </Button>
        )
      }
    >
      <div className="space-y-5">
        {operatorKey ? (
          <div className="space-y-1.5">
            <Label>Klucz API Claude</Label>
            <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <ServerCog className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
              <p>
                <strong className="text-foreground">Klucz AI ustawia operator instancji.</strong> Nie zmienia się
                go w panelu, a ewentualny klucz zapisany tutaj wcześniej nie jest używany. W sprawie klucza lub
                kredytów API skontaktuj się z operatorem.
              </p>
            </div>
          </div>
        ) : (
          <>
            <ol className="space-y-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <li>
                <strong className="text-foreground">1.</strong> Na claude.ai (konto z planem <strong>Max</strong>, min.
                7 dni) otwórz{' '}
                <a href={CLAUDE_BILLING_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                  Settings → Billing
                  <ExternalLink className="h-3 w-3" />
                </a>{' '}
                i w sekcji <strong>API credits</strong> kliknij <strong>Link organization</strong>.
              </li>
              <li>
                <strong className="text-foreground">2.</strong> W podlinkowanej organizacji utwórz klucz:{' '}
                <a href={CONSOLE_KEYS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                  Claude Console → API keys
                  <ExternalLink className="h-3 w-3" />
                </a>
                .
              </li>
              <li>
                <strong className="text-foreground">3.</strong> Wklej klucz poniżej i zapisz.
              </li>
              <li className="border-t pt-2">
                Max 5x daje $100, a Max 20x $200 kredytów miesięcznie. Kredyty nie przechodzą na kolejny miesiąc
                i nie zmniejszają limitów czatu w Claude. Po ich wyczerpaniu AI w systemie zatrzymuje się do
                odnowienia, chyba że organizacja ma dokupione kredyty.
              </li>
            </ol>

            <div className="space-y-1.5">
              <Label htmlFor="ai-api-key">Klucz API Claude</Label>
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
              <div className="relative">
                <Input
                  id="ai-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={form.newKey}
                  onChange={(e) => setForm({ ...form, newKey: e.target.value })}
                  placeholder={hasKey ? 'Wklej nowy klucz, aby zastąpić zapisany' : 'sk-ant-api03-...'}
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
                Zapisany klucz nie jest odczytywany przez przeglądarkę (widać tylko jego końcówkę). Funkcje AI
                korzystają z niego wyłącznie po stronie serwera.
              </p>
              {hasUnsavedKey && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  Klucz nie jest jeszcze zapisany. Kliknij <strong>Zapisz</strong>, żeby sprawdzić połączenie z Claude.
                </p>
              )}
            </div>
          </>
        )}

        {connection?.ok === false && connection.code !== 'AI_NOT_CONFIGURED' && (
          <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{connection.error}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="ai-model">Model</Label>
          {operatorModel ? (
            <Input
              id="ai-model"
              value={connection?.ok ? connection.model : ''}
              placeholder="Ustawiony przez operatora"
              readOnly
              disabled
              className="font-mono"
            />
          ) : models.length > 0 ? (
            <SearchSelect
              id="ai-model"
              value={form.model}
              onChange={(model) => {
                if (model) setForm({ ...form, model });
              }}
              placeholder="Wybierz model"
              options={modelOptions.map((m) => ({
                value: m.id,
                label: m.display_name,
                description: m.display_name === m.id ? undefined : m.id,
              }))}
            />
          ) : (
            <Input
              id="ai-model"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              className="font-mono"
            />
          )}
          <p className="text-xs text-muted-foreground">
            {operatorModel
              ? 'Model ustawia operator instancji - nie zmienia się go w panelu.'
              : models.length > 0
                ? 'Lista modeli dostępnych dla klucza. Mocniejszy model szybciej zużywa kredyty.'
                : 'Lista modeli pojawi się po zapisaniu działającego klucza.'}
          </p>
          {connection?.ok && !connection.model_available && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              {operatorModel ? (
                <span>
                  Model <code className="font-mono">{connection.model}</code> ustawiony przez operatora nie jest
                  dostępny dla tego klucza. Skontaktuj się z operatorem instancji.
                </span>
              ) : (
                <span>
                  Zapisany model <code className="font-mono">{connection.model}</code> nie jest dostępny dla tego
                  klucza. Wybierz inny i zapisz.
                </span>
              )}
            </p>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}

/** Status połączenia z Claude; współdzielony z kafelkiem na liście integracji. */
export function AiStatusBadge({
  isLoading,
  connection,
  error,
}: {
  isLoading: boolean;
  connection: AiConnection | undefined;
  error: Error | null;
}) {
  if (isLoading) {
    return (
      <StatusPill tone="warning" icon={<Loader2 className="h-3 w-3 animate-spin" />}>
        Sprawdzam...
      </StatusPill>
    );
  }
  if (connection?.ok === false && connection.code === 'AI_NOT_CONFIGURED') {
    return <StatusPill tone="neutral">Nieskonfigurowane</StatusPill>;
  }
  if (error || connection?.ok === false) {
    return (
      <StatusPill
        tone="danger"
        title={error?.message ?? (connection?.ok === false ? connection.error : undefined)}
        icon={<XCircle className="h-3 w-3" />}
      >
        Błąd
      </StatusPill>
    );
  }
  if (connection?.ok && !connection.model_available) {
    return (
      <StatusPill tone="warning" icon={<AlertTriangle className="h-3 w-3" />}>
        Zmień model
      </StatusPill>
    );
  }
  if (connection?.ok) {
    return (
      <StatusPill tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>
        Połączono
      </StatusPill>
    );
  }
  return null;
}

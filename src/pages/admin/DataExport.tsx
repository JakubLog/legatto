import { useState, type FormEvent } from 'react';
import { CheckCircle2, DatabaseBackup, Download, Eye, EyeOff, Info, Loader2, Lock, X } from 'lucide-react';
import { toast } from 'sonner';

import { Page, PageHeader } from '@/components/layout/Page';
import { SettingsCard } from '@/components/admin/AdminUi';
import { AdminSurfaceNotice } from '@/components/admin/AdminSurfaceNotice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  EXPORT_PASSWORD_MAX,
  EXPORT_PASSWORD_MIN,
  exportPasswordStrength,
  isExportAborted,
  useDataExport,
} from '@/hooks/useDataExport';
import { isAdminSurfaceRequired } from '@/lib/adminSurface';
import { cn } from '@/lib/utils';

const STRENGTH: Record<0 | 1 | 2 | 3 | 4, { label: string; bar: string }> = {
  0: { label: `Za krótkie (min. ${EXPORT_PASSWORD_MIN} znaków)`, bar: 'bg-destructive' },
  1: { label: 'Słabe', bar: 'bg-destructive' },
  2: { label: 'Średnie', bar: 'bg-amber-500' },
  3: { label: 'Dobre', bar: 'bg-emerald-500' },
  4: { label: 'Bardzo dobre', bar: 'bg-emerald-600' },
};

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
    : bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} kB`;

function ExportContents() {
  return (
    <SettingsCard
      icon={Info}
      title="Co zawiera eksport"
      description="Pełna kopia danych biura do przechowania poza serwerem (np. na zaszyfrowanym dysku posła)."
    >
      <ul className="list-disc space-y-1.5 pl-5 text-sm marker:text-muted-foreground">
        <li>
          Tabele biura w formacie JSON Lines: kontakty, sprawy z historią i komentarzami, kalendarz, interpelacje,
          dokumenty do podpisu, budżet i wydatki, newslettery, wpisy bloga, rozmowy PoliAI, biura i zespół, dziennik
          zmian.
        </li>
        <li>Pliki: załączniki spraw, dokumenty do podpisu, paragony i faktury, zdjęcia strony, newslettera i awatary.</li>
        <li>
          Bez sekretów: archiwum nie zawiera haseł użytkowników, kluczy API, tokenów MCP/OAuth, PIN-ów, subskrypcji
          push ani zaufanych urządzeń.
        </li>
        <li>Każdy eksport (rozpoczęcie, zakończenie, błąd) jest zapisywany w dzienniku zmian.</li>
      </ul>
    </SettingsCard>
  );
}

function ExportForm() {
  const { state, start, cancel, reset } = useDataExport();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [includeFiles, setIncludeFiles] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  const length = [...password].length;
  const strength = exportPasswordStrength(password);
  const tooLong = length > EXPORT_PASSWORD_MAX;
  const mismatch = confirm !== '' && confirm !== password;
  const valid = strength > 0 && !tooLong && confirm === password;
  const busy = state.phase === 'waiting' || state.phase === 'downloading';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!valid || busy) return;
    try {
      await start(password, includeFiles);
      setPassword('');
      setConfirm('');
      setSubmitted(false);
      toast.success('Eksport pobrany', { description: 'Przechowuj archiwum i hasło oddzielnie.' });
    } catch (err) {
      if (isExportAborted(err)) {
        toast.info('Eksport anulowany');
        return;
      }
      toast.error('Eksport nie powiódł się', { description: err instanceof Error ? err.message : 'Nieznany błąd' });
    }
  };

  const passwordProblem = tooLong
    ? `Hasło może mieć najwyżej ${EXPORT_PASSWORD_MAX} znaków`
    : submitted && strength === 0
      ? `Hasło musi mieć co najmniej ${EXPORT_PASSWORD_MIN} znaków`
      : null;
  const confirmProblem = mismatch || (submitted && confirm !== password) ? 'Hasła muszą być takie same' : null;

  return (
    <SettingsCard
      icon={Lock}
      title="Hasło archiwum"
      description="Archiwum ZIP jest szyfrowane AES-256 tym hasłem. Hasła nie da się odzyskać - zapisz je w menedżerze haseł."
      footer={
        busy ? (
          <Button type="button" variant="ghost" onClick={cancel}>
            <X className="h-4 w-4" />
            Anuluj
          </Button>
        ) : undefined
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="grid gap-3 @md:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="export-password">Hasło</Label>
            <div className="relative">
              <Input
                id="export-password"
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={passwordProblem ? true : undefined}
                aria-describedby="export-password-strength"
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-9 w-9 max-md:h-11 max-md:w-11"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Ukryj hasło' : 'Pokaż hasło'}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex gap-1" aria-hidden>
              {[1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={cn('h-1 flex-1 rounded-full', password && strength >= i ? STRENGTH[strength].bar : 'bg-muted')}
                />
              ))}
            </div>
            <p
              id="export-password-strength"
              className={cn('text-xs', passwordProblem ? 'text-destructive' : 'text-muted-foreground')}
            >
              {passwordProblem ??
                (password
                  ? `Siła hasła: ${STRENGTH[strength].label}`
                  : `Min. ${EXPORT_PASSWORD_MIN} znaków; najlepiej kilka losowych słów albo hasło z menedżera haseł.`)}
            </p>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="export-password-confirm">Powtórz hasło</Label>
            <Input
              id="export-password-confirm"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              disabled={busy}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={confirmProblem ? true : undefined}
              aria-describedby={confirmProblem ? 'export-password-confirm-error' : undefined}
            />
            {confirmProblem && (
              <p id="export-password-confirm-error" className="text-xs text-destructive">
                {confirmProblem}
              </p>
            )}
          </div>
        </div>

        <label className="flex items-start gap-3 text-sm">
          <Switch checked={includeFiles} onCheckedChange={setIncludeFiles} disabled={busy} className="mt-0.5" />
          <span>
            <span className="font-medium">Dołącz pliki</span>
            <span className="block text-xs text-muted-foreground">
              Załączniki, dokumenty, paragony i zdjęcia. Bez plików archiwum zawiera tylko tabele (szybciej, mniejszy
              rozmiar).
            </span>
          </span>
        </label>

        <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          Archiwum otworzysz programem obsługującym ZIP AES-256: 7-Zip (Windows), WinZip, Keka (macOS). Wbudowany
          „Archiwizator” macOS i Eksplorator Windows nie otwierają takich archiwów.
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || (submitted && !valid)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Pobierz eksport
          </Button>
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {state.phase === 'waiting' && 'Przygotowuję eksport…'}
            {state.phase === 'downloading' &&
              `Pobieranie… ${state.bytes > 0 ? formatBytes(state.bytes) : ''} Nie zamykaj tej karty.`}
            {state.phase === 'done' && (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Zapisano {state.fileName} ({formatBytes(state.bytes)}).
                <button type="button" className="underline" onClick={reset}>
                  Ukryj
                </button>
              </span>
            )}
          </p>
        </div>
      </form>
    </SettingsCard>
  );
}

/** Eksport danych biura dla posła (A13) - Poseł i Administrator, tylko panel administracyjny. */
export default function AdminDataExport() {
  return (
    <Page narrow>
      <PageHeader
        icon={DatabaseBackup}
        title="Eksport danych"
        description="Pobierz zaszyfrowaną kopię wszystkich danych i plików biura."
      />
      <div className="space-y-4">
        {isAdminSurfaceRequired() ? <AdminSurfaceNotice feature="Eksport danych biura" /> : <ExportForm />}
        <ExportContents />
      </div>
    </Page>
  );
}

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsSection } from '@/components/common/SettingsSection';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { useAuth } from '@/contexts/AuthContext';
import { useChallengeAndVerifyTotp, useUnenrollTotp } from '@/hooks/useMfa';

export function Mfa2FaCard() {
  const { mfa, refreshMfa } = useAuth();
  const verifyMut = useChallengeAndVerifyTotp();
  const unenrollMut = useUnenrollTotp();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Świeży kod z obecnego klucza: sama otwarta sesja (np. cudza, niezablokowana przeglądarka)
  // nie wystarcza do podmiany 2FA na własny klucz.
  const [code, setCode] = useState('');
  const busy = verifyMut.isPending || unenrollMut.isPending;

  const factor = mfa.verifiedTotp;
  const enrolledAt =
    factor && 'created_at' in factor && typeof (factor as { created_at?: string }).created_at === 'string'
      ? (factor as { created_at: string }).created_at
      : null;

  const closeConfirm = () => {
    setConfirmOpen(false);
    setCode('');
  };

  const handleUnenroll = async () => {
    if (!factor) return;
    try {
      await verifyMut.mutateAsync({ factorId: factor.id, code });
    } catch (err) {
      toast.error('Nieprawidłowy kod', {
        description: err instanceof Error ? err.message : 'Spróbuj ponownie.',
      });
      setCode('');
      return;
    }
    try {
      await unenrollMut.mutateAsync({ factorId: factor.id });
      await refreshMfa();
      toast.success('Klucz 2FA usunięty', {
        description: 'Skonfiguruj nowy klucz na ekranie, który się pojawi.',
      });
      closeConfirm();
      // ProtectedRoute pokaze MfaEnrollmentScreen automatycznie po refreshMfa
    } catch (err) {
      toast.error('Nie udało się usunąć klucza', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  return (
    <>
      <SettingsSection
        icon={KeyRound}
        title="Bezpieczeństwo (2FA)"
        description="Drugi składnik logowania - kod jednorazowy z aplikacji authenticator."
      >
        {factor ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border p-3 @max-md:items-start">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <CheckCircle2 className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">2FA aktywne</p>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Włączone
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  Klucz: <span className="font-medium text-foreground">{factor.friendly_name ?? '—'}</span>
                  {enrolledAt && (
                    <>
                      {' · '}aktywowany{' '}
                      {format(new Date(enrolledAt), 'd MMM yyyy', { locale: pl })}
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="space-y-3 rounded-lg bg-muted/40 p-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="text-[13px] font-medium text-foreground">Nowy telefon lub aplikacja?</p>
                <p>
                  Możesz usunąć aktualny klucz (potwierdzisz to kodem z obecnej aplikacji) i
                  skonfigurować nowy - zostaniesz o to poproszony od razu (2FA jest wymagane dla
                  wszystkich kont). Bez dostępu do obecnej aplikacji poproś Posła lub Administratora
                  biura o reset 2FA.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={busy}
                className="max-md:min-h-11 max-md:w-full"
              >
                Usuń i skonfiguruj ponownie
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Brak skonfigurowanego klucza 2FA. Przy najbliższym wejściu do portalu zostaniesz
              poproszony o jego dodanie.
            </p>
          </div>
        )}
      </SettingsSection>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) closeConfirm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usunąć klucz 2FA?</DialogTitle>
            <DialogDescription>
              Aktualny klucz zostanie usunięty i od razu trzeba będzie skonfigurować nowy (2FA jest
              wymagane dla wszystkich kont).
            </DialogDescription>
          </DialogHeader>

          <form
            id="mfa-unenroll-form"
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{6}$/.test(code) && !busy) void handleUnenroll();
            }}
          >
            <Label htmlFor="mfa-unenroll-code">Kod z obecnej aplikacji authenticator</Label>
            <Input
              id="mfa-unenroll-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
            />
          </form>

          <DialogFooter className="max-md:!flex-col-reverse max-md:!gap-3 max-md:!space-x-0">
            <Button
              variant="outline"
              className="max-md:w-full"
              onClick={closeConfirm}
              disabled={busy}
            >
              Anuluj
            </Button>
            <Button
              type="submit"
              form="mfa-unenroll-form"
              variant="destructive"
              className="max-md:w-full"
              disabled={!/^\d{6}$/.test(code) || busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Usuń klucz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DangerTitleIcon } from '@/components/admin/AdminUi';

import { useRevokeUserSessions } from '@/hooks/useUsers';
import type { ProfileWithOffice } from '@/integrations/supabase/types';

interface Props {
  user: ProfileWithOffice | null;
  onClose: () => void;
}

const CONFIRM_PHRASE = 'WYLOGUJ';

export function RevokeSessionsDialog({ user, onClose }: Props) {
  const revokeMut = useRevokeUserSessions();
  const [confirmInput, setConfirmInput] = useState('');

  const handleConfirm = async () => {
    if (!user) return;
    try {
      const result = await revokeMut.mutateAsync(user.id);
      const mfaInfo =
        result.mfa_deleted_count > 0
          ? `Usunięto ${result.mfa_deleted_count} klucz(y) 2FA.`
          : 'Użytkownik nie miał aktywnego 2FA.';
      toast.success('Wylogowano ze wszystkich urządzeń', {
        description: result.recovery_sent
          ? `Sesje, hasło i tokeny MCP unieważnione. ${mfaInfo} Wysłano mail z linkiem do ustawienia nowego hasła.`
          : `Sesje, hasło i tokeny MCP unieważnione. ${mfaInfo} ${user.is_active ? 'Mail nie został wysłany - wyślij link ponownie z listy użytkowników.' : 'Konto jest nieaktywne, więc mail nie został wysłany.'}`,
      });
      setConfirmInput('');
      onClose();
    } catch (err) {
      toast.error('Nie udało się wylogować użytkownika', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  return (
    <Dialog
      open={Boolean(user)}
      onOpenChange={(open) => {
        if (!open) {
          setConfirmInput('');
          onClose();
        }
      }}
    >
      {user && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <DangerTitleIcon icon={AlertTriangle} />
              Wylogować ze wszystkich urządzeń?
            </DialogTitle>
            <DialogDescription className="max-md:[overflow-wrap:anywhere]">
              Wszystkie sesje użytkownika <strong>{user.full_name}</strong> ({user.email}) zostaną
              unieważnione, klucze 2FA usunięte, a hasło unieważnione. Tokeny MCP i aplikacje OAuth
              zostaną odwołane. Użytkownik dostanie mail z linkiem do ustawienia nowego hasła i 2FA.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="rounded-lg border bg-muted/40 p-3 text-xs">
              <p className="font-medium text-foreground">Kiedy używać:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                <li>Zwolnienie pracownika / utrata uprawnień</li>
                <li>Zgubiony lub skradziony laptop / telefon</li>
                <li>Podejrzenie kompromitacji konta</li>
              </ul>
              <p className="mt-2 text-muted-foreground">
                Jeśli chcesz tylko zresetować 2FA — użyj <em>Resetuj 2FA</em>. Jeśli tylko
                zablokować dostęp — <em>Deaktywuj konto</em>.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-revoke-sessions">
                Wpisz <strong>{CONFIRM_PHRASE}</strong> aby potwierdzić
              </Label>
              <Input
                id="confirm-revoke-sessions"
                autoComplete="off"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder={CONFIRM_PHRASE}
              />
            </div>
          </div>

          <DialogFooter className="max-md:!flex-col-reverse max-md:!gap-3 max-md:!space-x-0">
            <Button
              variant="outline"
              className="max-md:w-full"
              onClick={() => {
                setConfirmInput('');
                onClose();
              }}
              disabled={revokeMut.isPending}
            >
              Anuluj
            </Button>
            <Button
              variant="destructive"
              className="max-md:w-full"
              onClick={handleConfirm}
              disabled={confirmInput.trim() !== CONFIRM_PHRASE || revokeMut.isPending}
            >
              {revokeMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Wyloguj wszędzie
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

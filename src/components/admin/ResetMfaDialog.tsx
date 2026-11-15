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

import { useResetUserMfa } from '@/hooks/useMfa';
import type { ProfileWithOffice } from '@/integrations/supabase/types';

interface Props {
  user: ProfileWithOffice | null;
  onClose: () => void;
}

const CONFIRM_PHRASE = 'RESETUJ';

export function ResetMfaDialog({ user, onClose }: Props) {
  const resetMut = useResetUserMfa();
  const [confirmInput, setConfirmInput] = useState('');

  const handleConfirm = async () => {
    if (!user) return;
    try {
      const result = await resetMut.mutateAsync(user.id);
      toast.success('2FA zresetowane', {
        description: result.recovery_sent
          ? `Usunięto ${result.deleted_count} klucz(y), hasło i tokeny MCP unieważnione. Wysłano mail z linkiem do ustawienia nowego hasła i 2FA.`
          : `Usunięto ${result.deleted_count} klucz(y), hasło i tokeny MCP unieważnione. ${user.is_active ? 'Mail nie został wysłany - wyślij link ponownie z listy użytkowników.' : 'Konto jest nieaktywne, więc mail nie został wysłany.'}`,
      });
      setConfirmInput('');
      onClose();
    } catch (err) {
      toast.error('Nie udało się zresetować 2FA', {
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
              Zresetować 2FA?
            </DialogTitle>
            <DialogDescription className="max-md:[overflow-wrap:anywhere]">
              Wszystkie klucze 2FA użytkownika <strong>{user.full_name}</strong> ({user.email})
              zostaną usunięte, a hasło unieważnione. Tokeny MCP i aplikacje OAuth zostaną odwołane.
              Użytkownik dostanie mail z linkiem do ustawienia nowego hasła i 2FA.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="rounded-lg border bg-muted/40 p-3 text-xs">
              <p className="font-medium text-foreground">Kiedy używać:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                <li>User zgubił telefon / wyzerował aplikację authenticator</li>
                <li>Migracja na nowe urządzenie</li>
                <li>Podejrzenie utraty kontroli nad kluczem</li>
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-reset-mfa">
                Wpisz <strong>{CONFIRM_PHRASE}</strong> aby potwierdzić
              </Label>
              <Input
                id="confirm-reset-mfa"
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
              disabled={resetMut.isPending}
            >
              Anuluj
            </Button>
            <Button
              variant="destructive"
              className="max-md:w-full"
              onClick={handleConfirm}
              disabled={confirmInput.trim() !== CONFIRM_PHRASE || resetMut.isPending}
            >
              {resetMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Resetuj 2FA
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

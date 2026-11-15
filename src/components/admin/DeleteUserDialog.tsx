import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

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

import type { ProfileWithOffice } from '@/integrations/supabase/types';
import { DangerTitleIcon } from '@/components/admin/AdminUi';

interface Props {
  user: ProfileWithOffice | null;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteUserDialog({ user, isPending, onClose, onConfirm }: Props) {
  const [confirmation, setConfirmation] = useState('');
  const expected = user?.full_name ?? '';
  const canDelete = confirmation.trim() === expected.trim() && expected.length > 0;
  return (
    <Dialog open={!!user} onOpenChange={(open) => { if (!open) { setConfirmation(''); onClose(); } }}>
      {user && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <DangerTitleIcon icon={AlertTriangle} />
              Trwałe usunięcie konta
            </DialogTitle>
            <DialogDescription className="max-md:[overflow-wrap:anywhere]">
              Konto <strong>{user.full_name}</strong> ({user.email}) zostanie trwale usunięte. Tej operacji nie da się cofnąć.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <p className="font-medium text-destructive">Co się stanie:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                <li>Konto auth + profil zostaną usunięte.</li>
                <li>Historia zachowana, ale autor będzie pusty.</li>
                <li>Avatar w storage pozostanie jako orphan.</li>
              </ul>
              <p className="mt-2 text-muted-foreground">Jeśli chcesz zablokować dostęp — użyj <em>Deaktywuj konto</em>.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-name">Wpisz <strong>{expected}</strong> aby potwierdzić</Label>
              <Input id="confirm-name" autoComplete="off" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder={expected} />
            </div>
          </div>
          <DialogFooter className="max-md:!flex-col-reverse max-md:!gap-3 max-md:!space-x-0">
            <Button variant="outline" className="max-md:w-full" onClick={onClose} disabled={isPending}>Anuluj</Button>
            <Button variant="destructive" className="max-md:w-full" disabled={!canDelete || isPending} onClick={onConfirm}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}Usuń trwale
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

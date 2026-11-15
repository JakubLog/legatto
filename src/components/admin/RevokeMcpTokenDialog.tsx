import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DangerTitleIcon } from '@/components/admin/AdminUi';

import { useRevokeMcpToken } from '@/hooks/useMcpTokens';
import type { McpToken } from '@/integrations/supabase/types';

interface Props {
  token: McpToken | null;
  onClose: () => void;
}

export function RevokeMcpTokenDialog({ token, onClose }: Props) {
  const revokeMut = useRevokeMcpToken();

  const handleConfirm = async () => {
    if (!token) return;
    try {
      await revokeMut.mutateAsync(token.id);
      toast.success('Token unieważniony', {
        description: `Klient MCP korzystający z "${token.name}" straci dostęp natychmiast.`,
      });
      onClose();
    } catch (err) {
      toast.error('Nie udało się unieważnić tokena', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  return (
    <Dialog open={Boolean(token)} onOpenChange={(open) => { if (!open) onClose(); }}>
      {token && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <DangerTitleIcon icon={AlertTriangle} />
              Unieważnić token?
            </DialogTitle>
            <DialogDescription>
              Token <strong>{token.name}</strong> (prefix <code className="rounded-md bg-muted px-1 py-0.5 font-mono text-xs">epm_{token.token_prefix}…</code>)
              przestanie działać natychmiast. Wszelkie aktywne sesje Claude tracą dostęp do MCP -
              żeby przywrócić, wygeneruj nowy token i zaktualizuj konfigurację.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={revokeMut.isPending}>
              Anuluj
            </Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={revokeMut.isPending}>
              {revokeMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Unieważnij
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

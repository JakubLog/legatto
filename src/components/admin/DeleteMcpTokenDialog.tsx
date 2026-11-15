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

import { useDeleteMcpToken } from '@/hooks/useMcpTokens';
import type { McpToken } from '@/integrations/supabase/types';

interface Props {
  token: McpToken | null;
  onClose: () => void;
}

export function DeleteMcpTokenDialog({ token, onClose }: Props) {
  const deleteMut = useDeleteMcpToken();

  const handleConfirm = async () => {
    if (!token) return;
    try {
      await deleteMut.mutateAsync(token.id);
      toast.success('Token usunięty', {
        description: `Wpis "${token.name}" zniknął z listy. Operacja zachowana w dzienniku zmian.`,
      });
      onClose();
    } catch (err) {
      toast.error('Nie udało się usunąć tokena', {
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
              Usunąć token na stałe?
            </DialogTitle>
            <DialogDescription>
              Wpis <strong>{token.name}</strong> (prefix <code className="rounded-md bg-muted px-1 py-0.5 font-mono text-xs">epm_{token.token_prefix}…</code>)
              zostanie usunięty z listy bez możliwości przywrócenia. Token jest już unieważniony,
              więc dostęp pozostaje zablokowany. Ślad operacji zachowamy w dzienniku zmian.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={deleteMut.isPending}>
              Anuluj
            </Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={deleteMut.isPending}>
              {deleteMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Usuń
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

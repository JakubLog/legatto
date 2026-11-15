import { Loader2, Trash2 } from 'lucide-react';
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
import { useDeleteInterpellation } from '@/hooks/useInterpellations';
import { useMovedToTrashToast } from '@/hooks/useTrash';
import { errorMessage } from '@/lib/errors';
import type { Interpellation } from '@/integrations/supabase/types';

interface Props {
  item: Pick<Interpellation, 'id' | 'subject'> | null;
  onClose: () => void;
  /** Wywoływane po udanym usunięciu (np. powrót do listy ze szczegółów). */
  onDeleted?: () => void;
}

export function DeleteInterpellationDialog({ item, onClose, onDeleted }: Props) {
  const deleteMut = useDeleteInterpellation();
  const movedToTrash = useMovedToTrashToast();

  const handleDelete = async () => {
    if (!item) return;
    try {
      await deleteMut.mutateAsync(item.id);
      movedToTrash('interpellation', item.id);
      onClose();
      onDeleted?.();
    } catch (err) {
      toast.error('Błąd usuwania', { description: errorMessage(err) });
    }
  };

  return (
    <Dialog open={Boolean(item)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex-row items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Trash2 className="h-[18px] w-[18px]" />
          </div>
          <div className="space-y-1.5 max-md:min-w-0">
            <DialogTitle>Przenieść interpelację do kosza?</DialogTitle>
            <DialogDescription className="max-md:break-words">
              {item ? `„${item.subject}” trafi do kosza. Przez 7 dni można ją przywrócić, potem zostanie usunięta trwale.` : ''}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={deleteMut.isPending}>
            Anuluj
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteMut.isPending}>
            {deleteMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Przenieś do kosza
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

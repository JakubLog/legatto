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
import { useDeleteExpense } from '@/hooks/useExpenses';
import { useMovedToTrashToast } from '@/hooks/useTrash';
import type { OfficeExpenseWithRelations } from '@/integrations/supabase/types';
import { errorMessage } from '@/lib/errors';

interface Props {
  expense: OfficeExpenseWithRelations | null;
  onClose: () => void;
}

export function DeleteExpenseDialog({ expense, onClose }: Props) {
  const deleteMut = useDeleteExpense();
  const movedToTrash = useMovedToTrashToast();

  const handleDelete = async () => {
    if (!expense) return;
    try {
      await deleteMut.mutateAsync(expense.id);
      movedToTrash('expense', expense.id);
      onClose();
    } catch (err) {
      toast.error('Błąd usuwania', { description: errorMessage(err) });
    }
  };

  return (
    <Dialog open={Boolean(expense)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader className="flex-row items-start gap-3 space-y-0 text-left">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Trash2 className="h-5 w-5" />
          </span>
          <div className="space-y-1.5">
            <DialogTitle>Przenieść wydatek do kosza?</DialogTitle>
            <DialogDescription>
              {expense ? `„${expense.title}” trafi do kosza razem z załącznikiem. Przez 7 dni można go przywrócić, potem zostanie usunięty trwale.` : ''}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:space-x-0">
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

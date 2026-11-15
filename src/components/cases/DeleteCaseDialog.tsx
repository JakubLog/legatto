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
import { useDeleteCase } from '@/hooks/useCases';
import { useMovedToTrashToast } from '@/hooks/useTrash';
import type { CaseWithRelations } from '@/integrations/supabase/types';

interface Props {
  case_: CaseWithRelations | null;
  onClose: () => void;
}

export function DeleteCaseDialog({ case_, onClose }: Props) {
  const deleteMut = useDeleteCase();
  const movedToTrash = useMovedToTrashToast();

  const handleDelete = async () => {
    if (!case_) return;
    try {
      await deleteMut.mutateAsync(case_.id);
      movedToTrash('case', case_.id);
      onClose();
    } catch (err) {
      toast.error('Błąd usuwania', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  return (
    <Dialog open={Boolean(case_)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader className="gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Trash2 className="h-5 w-5" />
          </div>
          <DialogTitle>Przenieść sprawę do kosza?</DialogTitle>
          <DialogDescription>
            {case_
              ? `„${case_.title}” razem z załącznikami, komentarzami i historią trafi do kosza. Przez 7 dni można ją przywrócić, potem zostanie usunięta trwale.`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
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

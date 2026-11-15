import { useQueryClient } from '@tanstack/react-query';
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
import { useBulkDeleteContacts } from '@/hooks/useContacts';

interface Props {
  ids: string[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}

export function BulkDeleteContactsDialog({ ids, open, onOpenChange, onDone }: Props) {
  const { mutateAsync, isPending } = useBulkDeleteContacts();
  const qc = useQueryClient();

  const handleConfirm = async () => {
    try {
      const n = await mutateAsync(ids);
      toast.success(`Przeniesiono do kosza: ${n} ${n === 1 ? 'kontakt' : 'kontaktów'}`, {
        description: 'Możesz przywrócić w ciągu 7 dni (Kosz).',
      });
      void qc.invalidateQueries({ queryKey: ['trash'] });
      onDone();
      onOpenChange(false);
    } catch {
      toast.error('Nie udało się usunąć kontaktów');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center sm:items-start sm:text-left">
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Trash2 className="h-5 w-5" />
          </div>
          <DialogTitle>Przenieść {ids.length} kontaktów do kosza?</DialogTitle>
          <DialogDescription>
            Zaznaczone kontakty trafią do kosza. Przez 7 dni można je przywrócić (Kosz), potem zostaną usunięte trwale.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Anuluj
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending || ids.length === 0}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? 'Przenoszenie…' : `Przenieś ${ids.length} do kosza`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

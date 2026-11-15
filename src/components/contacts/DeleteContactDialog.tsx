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
import { useDeleteContact } from '@/hooks/useContacts';
import { useMovedToTrashToast } from '@/hooks/useTrash';
import type { ContactWithRelations } from '@/integrations/supabase/types';

interface Props {
  contact: ContactWithRelations | null;
  onClose: () => void;
}

export function DeleteContactDialog({ contact, onClose }: Props) {
  const deleteMut = useDeleteContact();
  const movedToTrash = useMovedToTrashToast();

  const handleDelete = async () => {
    if (!contact) return;
    try {
      await deleteMut.mutateAsync(contact.id);
      movedToTrash('contact', contact.id);
      onClose();
    } catch (err) {
      toast.error('Błąd usuwania', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  return (
    <Dialog open={Boolean(contact)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center sm:items-start sm:text-left">
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Trash2 className="h-5 w-5" />
          </div>
          <DialogTitle>Przenieść kontakt do kosza?</DialogTitle>
          <DialogDescription>
            {contact
              ? `${contact.first_name} ${contact.last_name} trafi do kosza. Przez 7 dni można go przywrócić (wraz z powiązaniami ze sprawami i wydarzeniami), potem zostanie usunięty trwale.`
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

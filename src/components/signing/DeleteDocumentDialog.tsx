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
import { useDeleteSigningDocument } from '@/hooks/useSigningDocuments';
import { useMovedToTrashToast } from '@/hooks/useTrash';
import { errorMessage } from '@/lib/errors';
import type { SigningDocument } from '@/lib/signing';

interface Props {
  document: SigningDocument | null;
  onClose: () => void;
  onDeleted?: () => void;
}

/** Trwałe usunięcie dokumentu (Poseł/administrator). */
export function DeleteDocumentDialog({ document: doc, onClose, onDeleted }: Props) {
  const mut = useDeleteSigningDocument();
  const movedToTrash = useMovedToTrashToast();

  const submit = async () => {
    if (!doc) return;
    try {
      await mut.mutateAsync(doc.id);
      movedToTrash('signing_document', doc.id, `${doc.code} w koszu`);
      onClose();
      onDeleted?.();
    } catch (err) {
      toast.error('Nie udało się usunąć dokumentu', { description: errorMessage(err) });
    }
  };

  return (
    <Dialog open={Boolean(doc)} onOpenChange={(o) => !o && !mut.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex-row items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Trash2 className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 space-y-1.5">
            <DialogTitle>Przenieść dokument do kosza?</DialogTitle>
            <DialogDescription>
              {doc && <span className="block break-words font-medium text-foreground">{doc.code} - {doc.title}</span>}
              Dokument razem z plikami i wersjami trafi do kosza. Przez 7 dni można go przywrócić, potem zostanie
              usunięty trwale.
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Wróć
          </Button>
          <Button variant="destructive" onClick={submit} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="animate-spin" />}
            Przenieś do kosza
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

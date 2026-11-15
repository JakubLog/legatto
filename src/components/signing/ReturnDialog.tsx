import { useEffect, useState } from 'react';
import { Loader2, Undo2 } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useReturnDocuments } from '@/hooks/useSigningDocuments';
import { errorMessage } from '@/lib/errors';
import { SIGNING_RETURN_NOTES_MAX, type SigningDocument } from '@/lib/signing';

interface Props {
  /** Dokumenty do zwrotu; pusta tablica = dialog zamknięty. */
  documents: SigningDocument[];
  onClose: () => void;
  onDone?: () => void;
}

/** Zwrot do poprawy z obowiązkowymi uwagami (Poseł/administrator); autor dostaje powiadomienie. */
export function ReturnDialog({ documents, onClose, onDone }: Props) {
  const [notes, setNotes] = useState('');
  const returnMut = useReturnDocuments();
  const open = documents.length > 0;

  useEffect(() => {
    if (open) setNotes('');
  }, [open]);

  const trimmed = notes.trim();
  const valid = trimmed.length > 0 && trimmed.length <= SIGNING_RETURN_NOTES_MAX;

  const submit = async () => {
    if (!valid) return;
    try {
      await returnMut.mutateAsync({ ids: documents.map((d) => d.id), notes: trimmed });
      toast.success(documents.length > 1 ? `Zwrócono do poprawy: ${documents.length}` : 'Zwrócono do poprawy');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error('Nie udało się zwrócić do poprawy', { description: errorMessage(err) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !returnMut.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-4 w-4 text-primary" aria-hidden />
            Zwróć do poprawy
          </DialogTitle>
          <DialogDescription>
            {documents.length === 1 ? (
              <span className="block break-words">
                <span className="font-mono">{documents[0].code}</span> - {documents[0].title}
              </span>
            ) : (
              `Zaznaczone dokumenty: ${documents.length}. Te same uwagi trafią do każdego autora.`
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="signing-return-notes">Uwagi *</Label>
          <Textarea
            id="signing-return-notes"
            rows={5}
            value={notes}
            maxLength={SIGNING_RETURN_NOTES_MAX}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Co trzeba poprawić?"
          />
          <p className="text-right text-xs tabular-nums text-muted-foreground">
            {notes.length}/{SIGNING_RETURN_NOTES_MAX}
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={returnMut.isPending}>
            Anuluj
          </Button>
          <Button onClick={submit} disabled={!valid || returnMut.isPending}>
            {returnMut.isPending && <Loader2 className="animate-spin" />}
            Zwróć do poprawy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

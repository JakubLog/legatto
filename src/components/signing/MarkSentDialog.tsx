import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, MailCheck } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useMarkSent } from '@/hooks/useSigningDocuments';
import { errorMessage } from '@/lib/errors';
import { SIGNING_SENT_NOTE_MAX, type SigningDocument } from '@/lib/signing';

interface Props {
  /** Dokumenty w statusie "Podpisany"; pusta tablica = dialog zamknięty. */
  documents: SigningDocument[];
  onClose: () => void;
  onDone?: () => void;
}

/** Ręczne oznaczenie wysyłki (poczta, ePUAP, osobiście). */
export function MarkSentDialog({ documents, onClose, onDone }: Props) {
  const [sentAt, setSentAt] = useState('');
  const [note, setNote] = useState('');
  const mut = useMarkSent();
  const open = documents.length > 0;

  useEffect(() => {
    if (open) {
      setSentAt(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
      setNote('');
    }
  }, [open]);

  const sentDate = sentAt ? new Date(sentAt) : null;
  const valid = Boolean(sentDate && !Number.isNaN(sentDate.getTime()) && sentDate.getTime() <= Date.now() + 60_000);

  const submit = async () => {
    if (!valid || !sentDate) return;
    try {
      await mut.mutateAsync({
        ids: documents.map((d) => d.id),
        sentAt: sentDate.toISOString(),
        note: note.trim() || null,
      });
      toast.success(documents.length > 1 ? `Oznaczono jako wysłane: ${documents.length}` : 'Oznaczono jako wysłany');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error('Nie udało się oznaczyć wysyłki', { description: errorMessage(err) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MailCheck className="h-4 w-4 text-primary" aria-hidden />
            Oznacz jako wysłane
          </DialogTitle>
          <DialogDescription>
            {documents.length === 1
              ? `${documents[0].code} - ${documents[0].title}`
              : `Zaznaczone dokumenty: ${documents.length}.`}{' '}
            Wysyłka poza portalem (np. poczta, ePUAP, osobiście).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="signing-sent-at">Data wysłania *</Label>
            <Input
              id="signing-sent-at"
              type="datetime-local"
              value={sentAt}
              max={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
              onChange={(e) => setSentAt(e.target.value)}
            />
            {!valid && sentAt && <p className="text-xs text-destructive">Data nie może być w przyszłości.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signing-sent-note">Notatka</Label>
            <Textarea
              id="signing-sent-note"
              rows={3}
              value={note}
              maxLength={SIGNING_SENT_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder="np. list polecony, numer nadania"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Anuluj
          </Button>
          <Button onClick={submit} disabled={!valid || mut.isPending}>
            {mut.isPending && <Loader2 className="animate-spin" />}
            Oznacz jako wysłane
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

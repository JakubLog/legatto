import { useEffect, useState } from 'react';
import { Ban, Loader2 } from 'lucide-react';
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
import { useCancelDocument } from '@/hooks/useSigningDocuments';
import { errorMessage } from '@/lib/errors';
import { SIGNING_CANCEL_REASON_MAX, type SigningDocument } from '@/lib/signing';

interface Props {
  document: SigningDocument | null;
  onClose: () => void;
}

/** Anulowanie dokumentu: zostaje w historii ze statusem "Anulowany"; pliki sprząta cron po 30 dniach. */
export function CancelDocumentDialog({ document: doc, onClose }: Props) {
  const [reason, setReason] = useState('');
  const mut = useCancelDocument();
  const docId = doc?.id ?? null;

  useEffect(() => {
    if (docId) setReason('');
  }, [docId]);

  const submit = async () => {
    if (!doc) return;
    try {
      await mut.mutateAsync({ id: doc.id, reason: reason.trim() || null });
      toast.success(`Anulowano ${doc.code}`);
      onClose();
    } catch (err) {
      toast.error('Nie udało się anulować dokumentu', { description: errorMessage(err) });
    }
  };

  return (
    <Dialog open={Boolean(doc)} onOpenChange={(o) => !o && !mut.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex-row items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Ban className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 space-y-1.5">
            <DialogTitle>Anulować dokument?</DialogTitle>
            <DialogDescription>
              {doc && <span className="block break-words font-medium text-foreground">{doc.code} - {doc.title}</span>}
              Dokument zniknie z obiegu. Pliki zostaną usunięte automatycznie po 30 dniach.
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="signing-cancel-reason">Powód</Label>
          <Textarea
            id="signing-cancel-reason"
            rows={3}
            value={reason}
            maxLength={SIGNING_CANCEL_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Wróć
          </Button>
          <Button variant="destructive" onClick={submit} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="animate-spin" />}
            Anuluj dokument
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { DocumentMetaFields, documentMetaPayload, type DocumentMetaValues } from '@/components/signing/DocumentMetaFields';
import { useUpdateSigningDocument } from '@/hooks/useSigningDocuments';
import { errorMessage } from '@/lib/errors';
import { SIGNING_TITLE_MAX, SIGNING_TITLE_MIN, type SigningDocument } from '@/lib/signing';

function metaFrom(doc: SigningDocument): DocumentMetaValues {
  return {
    description: doc.description ?? '',
    recipient_name: doc.recipient_name ?? '',
    case_id: doc.case_id,
    due_date: doc.due_date ?? '',
    send_subject: doc.send_subject ?? '',
    send_text: doc.send_text ?? '',
  };
}

interface Props {
  document: SigningDocument | null;
  onClose: () => void;
}

/**
 * Edycja danych dokumentu: autor w statusach "Do podpisu" i "Do poprawy", Poseł/administrator do
 * statusu "Podpisany" (canUpdateDocument). Odmowę z bazy (np. dokument pobrano do podpisu w trakcie
 * edycji) pokazuje toast z polskim komunikatem RPC.
 */
export function EditDocumentDialog({ document: doc, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [meta, setMeta] = useState<DocumentMetaValues | null>(null);
  const mut = useUpdateSigningDocument();

  useEffect(() => {
    if (doc) {
      setTitle(doc.title);
      setMeta(metaFrom(doc));
    }
    // Formularz inicjujemy przy otwarciu, nie przy każdym odświeżeniu danych w tle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  const trimmed = title.trim();
  const valid = trimmed.length >= SIGNING_TITLE_MIN && trimmed.length <= SIGNING_TITLE_MAX;

  const submit = async () => {
    if (!doc || !meta || !valid) return;
    try {
      await mut.mutateAsync({ id: doc.id, patch: { title: trimmed, ...documentMetaPayload(meta) } });
      toast.success('Zapisano zmiany');
      onClose();
    } catch (err) {
      toast.error('Nie udało się zapisać zmian', { description: errorMessage(err) });
    }
  };

  return (
    <Dialog open={Boolean(doc)} onOpenChange={(o) => !o && !mut.isPending && onClose()}>
      <DialogContent className="gap-5 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edytuj dokument</DialogTitle>
          <DialogDescription>{doc?.code}</DialogDescription>
        </DialogHeader>
        {meta && (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="signing-edit-title">Tytuł *</Label>
              <Input
                id="signing-edit-title"
                value={title}
                maxLength={SIGNING_TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
              />
              {!valid && <p className="text-xs text-destructive">Tytuł: od {SIGNING_TITLE_MIN} do {SIGNING_TITLE_MAX} znaków</p>}
            </div>
            <DocumentMetaFields
              idPrefix="signing-edit"
              values={meta}
              onChange={(p) => setMeta((m) => (m ? { ...m, ...p } : m))}
              disabled={mut.isPending}
            />
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Anuluj
          </Button>
          <Button onClick={submit} disabled={!valid || mut.isPending}>
            {mut.isPending && <Loader2 className="animate-spin" />}
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

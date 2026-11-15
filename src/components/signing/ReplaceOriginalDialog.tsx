import { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
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
import { FileDropZone } from '@/components/signing/FileDropZone';
import { useReplaceOriginal } from '@/hooks/useSigningDocuments';
import { uploadOriginalFile } from '@/hooks/useSigningFiles';
import { errorMessage } from '@/lib/errors';
import {
  SIGNING_FILE_MAX_BYTES,
  SIGNING_RETURN_NOTES_MAX,
  fileExtension,
  formatFileSize,
  isOriginalExtension,
  type SigningDocument,
} from '@/lib/signing';

interface Props {
  document: SigningDocument | null;
  onClose: () => void;
}

/** Nowa wersja oryginału (v+1): poprzednie pliki przestają być bieżące, dokument wraca "Do podpisu". */
export function ReplaceOriginalDialog({ document: doc, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const mut = useReplaceOriginal();

  const docId = doc?.id ?? null;
  useEffect(() => {
    if (docId) {
      setFile(null);
      setNote('');
    }
  }, [docId]);

  const error = file
    ? !isOriginalExtension(fileExtension(file.name))
      ? 'Dozwolone są tylko pliki PDF i DOCX'
      : file.size === 0
        ? 'Plik jest pusty'
        : file.size > SIGNING_FILE_MAX_BYTES
          ? `Plik większy niż ${formatFileSize(SIGNING_FILE_MAX_BYTES)}`
          : null
    : null;

  const submit = async () => {
    if (!doc || !file || error) return;
    setBusy(true);
    try {
      const payload = await uploadOriginalFile(doc.id, doc.current_version + 1, file);
      await mut.mutateAsync({ id: doc.id, file: payload, note: note.trim() || null });
      toast.success(`Wgrano wersję v${doc.current_version + 1}`);
      onClose();
    } catch (err) {
      toast.error('Nie udało się wgrać nowej wersji', { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(doc)} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nowa wersja dokumentu</DialogTitle>
          <DialogDescription>
            {doc && (
              <>
                {doc.code}: wersja v{doc.current_version} zostanie zastąpiona przez v{doc.current_version + 1}. Dokument wróci
                do statusu „Do podpisu”.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {doc?.status === 'do_poprawy' && doc.return_notes && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <p className="text-xs font-medium text-destructive">Uwagi do poprawy</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{doc.return_notes}</p>
            </div>
          )}
          <FileDropZone
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple={false}
            disabled={busy}
            onFiles={(files) => setFile(files[0] ?? null)}
            hint={`PDF lub DOCX, do ${formatFileSize(SIGNING_FILE_MAX_BYTES)}`}
          />
          {file && (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatFileSize(file.size)}</span>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="signing-replace-note">Co się zmieniło</Label>
            <Textarea
              id="signing-replace-note"
              rows={3}
              value={note}
              maxLength={SIGNING_RETURN_NOTES_MAX}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Anuluj
          </Button>
          <Button onClick={submit} disabled={!file || Boolean(error) || busy}>
            {busy && <Loader2 className="animate-spin" />}
            Wgraj nową wersję
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

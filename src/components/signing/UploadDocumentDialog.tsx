import { useEffect, useState } from 'react';
import { FileText, Loader2, Trash2 } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import {
  DocumentMetaFields,
  EMPTY_DOCUMENT_META,
  documentMetaPayload,
  type DocumentMetaValues,
} from '@/components/signing/DocumentMetaFields';
import { FileDropZone } from '@/components/signing/FileDropZone';
import { useCreateSigningDocuments, type CreateSigningItem } from '@/hooks/useSigningDocuments';
import { uploadOriginalFile } from '@/hooks/useSigningFiles';
import { useMpForms } from '@/hooks/useMpForms';
import { errorMessage } from '@/lib/errors';
import {
  SIGNING_CREATE_MAX,
  SIGNING_FILE_MAX_BYTES,
  SIGNING_TITLE_MAX,
  SIGNING_TITLE_MIN,
  fileExtension,
  formatFileSize,
  isOriginalExtension,
  titleFromFilename,
} from '@/lib/signing';

interface PendingFile {
  key: string;
  file: File;
  title: string;
}

function fileError(entry: PendingFile): string | null {
  const ext = fileExtension(entry.file.name);
  if (!isOriginalExtension(ext)) return 'Dozwolone są tylko pliki PDF i DOCX';
  if (entry.file.size === 0) return 'Plik jest pusty';
  if (entry.file.size > SIGNING_FILE_MAX_BYTES) return `Plik większy niż ${formatFileSize(SIGNING_FILE_MAX_BYTES)}`;
  const title = entry.title.trim();
  if (title.length < SIGNING_TITLE_MIN) return `Tytuł: co najmniej ${SIGNING_TITLE_MIN} znaki`;
  return null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Po zapisie: identyfikatory nowych dokumentów. */
  onCreated?: (ids: string[]) => void;
}

/** Wgranie dokumentów do podpisu: każdy plik to osobny dokument ze wspólnymi danymi adresata i wysyłki. */
export function UploadDocumentDialog({ open, onOpenChange, onCreated }: Props) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [meta, setMeta] = useState<DocumentMetaValues>(EMPTY_DOCUMENT_META);
  const [requiresSignature, setRequiresSignature] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const createMut = useCreateSigningDocuments();
  const mp = useMpForms();
  const busy = progress !== null;

  useEffect(() => {
    if (open) {
      setFiles([]);
      setMeta(EMPTY_DOCUMENT_META);
      setRequiresSignature(true);
      setProgress(null);
    }
  }, [open]);

  const addFiles = (list: File[]) => {
    setFiles((prev) => {
      const next = [...prev, ...list.map((file) => ({ key: crypto.randomUUID(), file, title: titleFromFilename(file.name) }))];
      if (next.length > SIGNING_CREATE_MAX) {
        toast.error(`Jednorazowo można dodać najwyżej ${SIGNING_CREATE_MAX} plików`);
        return next.slice(0, SIGNING_CREATE_MAX);
      }
      return next;
    });
  };

  const errors = files.map(fileError);
  const valid = files.length > 0 && errors.every((e) => e === null);
  const hasDocx = files.some((f) => fileExtension(f.file.name) === 'docx');

  const submit = async () => {
    if (!valid || busy) return;
    const shared = documentMetaPayload(meta);
    const items: CreateSigningItem[] = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        setProgress(`Wgrywanie pliku ${i + 1} z ${files.length}…`);
        const id = crypto.randomUUID();
        const file = await uploadOriginalFile(id, 1, files[i].file);
        items.push({
          id,
          title: files[i].title.trim().slice(0, SIGNING_TITLE_MAX),
          ...shared,
          requires_signature: requiresSignature,
          file,
        });
      }
      setProgress('Zapisywanie…');
      const created = await createMut.mutateAsync(items);
      toast.success(created.length > 1 ? `Dodano dokumenty: ${created.length}` : `Dodano ${created[0]?.code ?? 'dokument'}`);
      onOpenChange(false);
      onCreated?.(created.map((c) => c.id));
    } catch (err) {
      toast.error('Nie udało się dodać dokumentów', { description: errorMessage(err) });
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="gap-5 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dodaj dokumenty do podpisu</DialogTitle>
          <DialogDescription>
            Każdy plik to osobny dokument. Najlepiej PDF - DOCX jest dozwolony, ale podpis PAdES wymaga PDF.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <FileDropZone
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={busy}
            onFiles={addFiles}
            hint={`PDF lub DOCX, do ${formatFileSize(SIGNING_FILE_MAX_BYTES)} na plik, najwyżej ${SIGNING_CREATE_MAX} plików`}
          />

          {files.length > 0 && (
            <ul className="space-y-2" aria-label="Pliki do dodania">
              {files.map((entry, i) => (
                <li key={entry.key} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate" title={entry.file.name}>
                      {entry.file.name}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatFileSize(entry.file.size)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      disabled={busy}
                      aria-label={`Usuń ${entry.file.name}`}
                      onClick={() => setFiles((prev) => prev.filter((f) => f.key !== entry.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-2 space-y-1">
                    <Label htmlFor={`signing-title-${entry.key}`} className="sr-only">
                      Tytuł dokumentu
                    </Label>
                    <Input
                      id={`signing-title-${entry.key}`}
                      value={entry.title}
                      maxLength={SIGNING_TITLE_MAX}
                      disabled={busy}
                      placeholder="Tytuł dokumentu"
                      onChange={(e) =>
                        setFiles((prev) => prev.map((f) => (f.key === entry.key ? { ...f, title: e.target.value } : f)))
                      }
                    />
                    {errors[i] && <p className="text-xs text-destructive">{errors[i]}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {hasDocx && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
              DOCX podpisuje się podpisem XAdES w osobnym pliku. Jeśli podpis ma być w samym dokumencie, zapisz go jako PDF.
            </p>
          )}

          <label className="flex items-start gap-3 rounded-lg border p-3">
            <Switch
              checked={requiresSignature}
              onCheckedChange={setRequiresSignature}
              disabled={busy}
              aria-label="Wymaga podpisu"
              className="mt-0.5"
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">Wymaga podpisu</span>
              <span className="block text-xs text-muted-foreground">
                {requiresSignature
                  ? `Dokument trafi do ${mp.genitive} do podpisu.`
                  : 'Załącznik bez podpisu - od razu gotowy do wysyłki.'}
              </span>
            </span>
          </label>

          <DocumentMetaFields idPrefix="signing-new" values={meta} onChange={(p) => setMeta((m) => ({ ...m, ...p }))} disabled={busy} />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {progress && (
            <p className="mr-auto self-center text-xs text-muted-foreground" role="status">
              {progress}
            </p>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Anuluj
          </Button>
          <Button onClick={submit} disabled={!valid || busy}>
            {busy && <Loader2 className="animate-spin" />}
            {files.length > 1 ? `Dodaj dokumenty (${files.length})` : 'Dodaj dokument'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

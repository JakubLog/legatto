import { useState } from 'react';
import { FileArchive, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button, type ButtonProps } from '@/components/ui/button';
import { fetchBatchForDownload, useCreateBatch } from '@/hooks/useSigningDocuments';
import { fetchSigningFileBlob, saveBlob } from '@/hooks/useSigningFiles';
import { useAssignableUsers } from '@/hooks/useUsers';
import { errorMessage } from '@/lib/errors';
import type { SigningDocument } from '@/lib/signing';
import { batchZipFilename, buildBatchZip, splitIntoBatches, type BatchListRow } from '@/lib/signingZip';

type DocInfo = Pick<SigningDocument, 'id' | 'code' | 'title' | 'recipient_name' | 'created_by'>;

type Source =
  /** Nowe paczki z zaznaczenia (dzielone po 20 od najstarszych); ustawia status "Pobrany w paczce". */
  | { documents: SigningDocument[]; batchId?: never }
  /** Ponowne pobranie zapisanej paczki (bez zmiany statusów). */
  | { batchId: string; documents?: never };

type Props = Source & {
  label?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  /** Wywoływane po pobraniu wszystkich paczek (np. wyczyszczenie zaznaczenia). */
  onDone?: () => void;
};

const TOAST_ID = 'signing-batch-download';

/** Pobiera paczki ZIP "do podpisu" zbudowane w przeglądarce (pliki blobem z sesją, bez kompresji). */
export function DownloadBatchButton({ label, variant = 'outline', size = 'sm', className, onDone, ...source }: Props) {
  const [busy, setBusy] = useState(false);
  const createBatch = useCreateBatch();
  const { data: users = [] } = useAssignableUsers();
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.full_name ?? null;

  const rowsFor = (items: { document_id: string; zip_name: string }[], docs: DocInfo[]): BatchListRow[] =>
    items.map((it) => {
      const doc = docs.find((d) => d.id === it.document_id);
      return {
        code: doc?.code ?? '-',
        title: doc?.title ?? '-',
        recipient: doc?.recipient_name ?? null,
        author: nameOf(doc?.created_by ?? null),
        zip_name: it.zip_name,
      };
    });

  const buildAndSave = async (
    batch: { code: string; items: { document_id: string; storage_path: string; zip_name: string }[] },
    docs: DocInfo[],
    progressLabel: string,
    date?: Date,
  ) => {
    const blob = await buildBatchZip(
      batch.code,
      batch.items.map((it) => ({ zip_name: it.zip_name, load: () => fetchSigningFileBlob(it.storage_path) })),
      rowsFor(batch.items, docs),
      (done, total) => toast.loading(`${progressLabel}: plik ${done} z ${total}`, { id: TOAST_ID }),
    );
    saveBlob(blob, batchZipFilename(batch.code, date));
  };

  const run = async () => {
    setBusy(true);
    try {
      if (source.batchId) {
        toast.loading('Przygotowanie paczki…', { id: TOAST_ID });
        const { batch, createdAt, documents } = await fetchBatchForDownload(source.batchId);
        await buildAndSave(batch, documents, batch.code, new Date(createdAt));
        toast.success(`Pobrano ${batch.code}`, { id: TOAST_ID });
      } else {
        const eligible = (source.documents ?? [])
          .filter((d) => d.requires_signature && (d.status === 'do_podpisu' || d.status === 'pobrany'))
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        if (eligible.length === 0) {
          toast.error('Brak dokumentów do pobrania', { id: TOAST_ID });
          return;
        }
        const chunks = splitIntoBatches(eligible);
        const codes: string[] = [];
        for (let i = 0; i < chunks.length; i += 1) {
          const prefix = chunks.length > 1 ? `Paczka ${i + 1} z ${chunks.length}` : 'Paczka';
          toast.loading(`${prefix}: przygotowanie…`, { id: TOAST_ID });
          const batch = await createBatch.mutateAsync(chunks[i].map((d) => d.id));
          await buildAndSave(batch, chunks[i], prefix);
          codes.push(batch.code);
          // Przeglądarki blokują serię pobrań bez odstępu.
          if (i < chunks.length - 1) await new Promise((r) => window.setTimeout(r, 600));
        }
        toast.success(codes.length > 1 ? `Pobrano ${codes.length} paczki ZIP` : `Pobrano ${codes[0]}`, {
          id: TOAST_ID,
          description:
            codes.length > 1
              ? `${codes.join(', ')}. Jeśli przeglądarka zapyta o pobieranie wielu plików, zezwól.`
              : `${eligible.length} dok. Status zmieniony na „Pobrany w paczce”.`,
        });
      }
      onDone?.();
    } catch (err) {
      toast.error('Nie udało się pobrać paczki', { id: TOAST_ID, description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const count = source.documents?.length;
  return (
    <Button type="button" variant={variant} size={size} className={className} disabled={busy || count === 0} onClick={run}>
      {busy ? <Loader2 className="animate-spin" /> : <FileArchive />}
      {label ?? (count !== undefined ? `Pobierz paczkę ZIP (${count})` : 'Pobierz paczkę ponownie')}
    </Button>
  );
}

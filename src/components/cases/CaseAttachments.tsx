import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FilePreviewDialog } from '@/components/files/FilePreviewDialog';
import { useAuth } from '@/contexts/AuthContext';
import { canWrite as canWriteRole, isAdmin } from '@/lib/permissions';
import {
  fetchCaseAttachmentBlob,
  useCaseAttachments,
  useUploadCaseAttachment,
  useDeleteCaseAttachment,
  type CaseAttachment,
} from '@/hooks/useCaseAttachments';
import { useMovedToTrashToast } from '@/hooks/useTrash';
import { cn } from '@/lib/utils';
import { ADD_TILE } from './inlineEdit';

const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
const MAX_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  caseId: string;
}

export function CaseAttachments({ caseId }: Props) {
  const { profile } = useAuth();
  const { data: attachments, isLoading } = useCaseAttachments(caseId);
  const uploadMut = useUploadCaseAttachment();
  const deleteMut = useDeleteCaseAttachment();
  const movedToTrash = useMovedToTrashToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [preview, setPreview] = useState<CaseAttachment | null>(null);

  const canWrite = canWriteRole(profile?.role);
  const canDelete = isAdmin(profile?.role);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!ALLOWED_MIME.includes(file.type)) {
      toast.error('Nieobsługiwany format pliku', {
        description: 'Dozwolone: PDF, JPG, PNG, WebP, DOC, DOCX, TXT',
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('Plik za duży', { description: 'Maksymalny rozmiar: 10 MB' });
      return;
    }

    try {
      await uploadMut.mutateAsync({ caseId, file });
      toast.success('Załącznik dodany');
    } catch (err) {
      toast.error('Błąd uploadu', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const handleDownload = async (attachment: CaseAttachment) => {
    setDownloading(attachment.id);
    try {
      // Blob z tej samej domeny: atrybut `download` zachowuje oryginalną nazwę (także polskie znaki).
      const url = URL.createObjectURL(await fetchCaseAttachmentBlob(attachment.storage_path));
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.filename;
      link.click();
      // Firefox potrzebuje chwili, zanim zacznie czytać obiekt; zwolnienie od razu przerywa zapis.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast.error('Błąd pobierania pliku');
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (attachment: CaseAttachment) => {
    try {
      await deleteMut.mutateAsync({ id: attachment.id, caseId });
      movedToTrash('case_attachment', attachment.id, 'Załącznik w koszu');
    } catch (err) {
      toast.error('Błąd usuwania', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const hasFiles = Boolean(attachments?.length);

  // Kafelki obok siebie (zawijane): stan wczytywania, pusty i z jednym plikiem mają tę samą
  // wysokość jednego rzędu, więc okno nie skacze po wczytaniu listy.
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">
        Załączniki
        {hasFiles && (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{attachments?.length}</span>
        )}
      </h3>

      <ul className="flex flex-wrap gap-2" aria-busy={isLoading || undefined}>
        {isLoading && (
          <li className="contents">
            <Skeleton className="h-10 w-44 rounded-lg max-md:h-11" />
          </li>
        )}

        {!isLoading && !canWrite && !hasFiles && (
          <li className="flex min-h-10 items-center text-xs text-muted-foreground max-md:min-h-11">
            Brak załączników.
          </li>
        )}

        {attachments?.map((a) => (
          <li
            key={a.id}
            className="flex h-10 min-w-0 max-w-full items-center rounded-lg border bg-card text-sm transition-colors hover:bg-muted/60 max-md:h-11 sm:max-w-[18rem]"
          >
            <button
              type="button"
              className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-l-lg pl-3 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              title={`Podgląd: ${a.filename}`}
              onClick={() => setPreview(a)}
            >
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{a.filename}</span>
              {a.size_bytes !== null && (
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(a.size_bytes)}</span>
              )}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn('h-8 w-8 shrink-0 max-md:h-11 max-md:w-10', !canDelete && 'mr-1 max-md:mr-0')}
              disabled={downloading === a.id}
              onClick={() => handleDownload(a)}
              title="Pobierz"
              aria-label={`Pobierz ${a.filename}`}
            >
              {downloading === a.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
            </Button>
            {canDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mr-1 h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive max-md:mr-0 max-md:h-11 max-md:w-10"
                disabled={deleteMut.isPending}
                onClick={() => handleDelete(a)}
                title="Usuń załącznik"
                aria-label={`Usuń załącznik ${a.filename}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </li>
        ))}

        {!isLoading && canWrite && (
          <li className={cn('flex', !hasFiles && 'w-full')}>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.txt"
              onChange={handleFileChange}
            />
            <button
              type="button"
              className={cn(ADD_TILE, hasFiles && 'w-auto')}
              disabled={uploadMut.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadMut.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
              {uploadMut.isPending ? 'Wgrywanie...' : hasFiles ? 'Dodaj plik' : 'Brak załączników - dodaj plik'}
            </button>
          </li>
        )}
      </ul>

      <FilePreviewDialog
        file={
          preview && {
            id: preview.id,
            name: preview.filename,
            mimeType: preview.mime_type,
            details: formatBytes(preview.size_bytes) || undefined,
            load: () => fetchCaseAttachmentBlob(preview.storage_path),
          }
        }
        onClose={() => setPreview(null)}
        onDownload={() => preview && handleDownload(preview)}
        downloading={preview !== null && downloading === preview.id}
      />
    </section>
  );
}

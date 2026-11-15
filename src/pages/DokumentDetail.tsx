import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { pl } from 'date-fns/locale';
import {
  ArrowLeft,
  Ban,
  Briefcase,
  Download,
  Eye,
  FilePlus2,
  FileSignature,
  FileText,
  FileX2,
  Loader2,
  MailCheck,
  MessageSquareText,
  Pencil,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Page, PageHeader } from '@/components/layout/Page';
import { FilePreviewDialog, type PreviewFile } from '@/components/files/FilePreviewDialog';
import { CancelDocumentDialog } from '@/components/signing/CancelDocumentDialog';
import { DeleteDocumentDialog } from '@/components/signing/DeleteDocumentDialog';
import { DocumentTimeline } from '@/components/signing/DocumentTimeline';
import { DownloadBatchButton } from '@/components/signing/DownloadBatchButton';
import { EditDocumentDialog } from '@/components/signing/EditDocumentDialog';
import { MarkSentDialog } from '@/components/signing/MarkSentDialog';
import { ReplaceOriginalDialog } from '@/components/signing/ReplaceOriginalDialog';
import { ReturnDialog } from '@/components/signing/ReturnDialog';
import { SignedUploadDialog } from '@/components/signing/SignedUploadDialog';
import { SigningStatusBadge } from '@/components/signing/SigningStatusBadge';
import { DueDate } from '@/components/signing/SigningRow';
import { useAuth } from '@/contexts/AuthContext';
import { useCase } from '@/hooks/useCases';
import { useModuleNarrow } from '@/hooks/useModuleNarrow';
import { useMpForms } from '@/hooks/useMpForms';
import { useDocumentBatches, useSigningDocument } from '@/hooks/useSigningDocuments';
import { fetchSigningFileBlob, useDownloadSigningFile } from '@/hooks/useSigningFiles';
import { useAssignableUsers } from '@/hooks/useUsers';
import { errorMessage } from '@/lib/errors';
import type { MpForms } from '@/lib/mpForms';
import { isAdmin } from '@/lib/permissions';
import {
  SIGNING_FILE_KIND_LABELS,
  canAttachSigned,
  canBatchDocument,
  canCancelDocument,
  canDeleteDocument,
  canMarkSent,
  canReplaceOriginal,
  canReturnDocument,
  canUpdateDocument,
  currentFiles,
  downloadFilename,
  formatFileSize,
  type SigningDocument,
  type SigningFile,
} from '@/lib/signing';

function stageDescription(doc: SigningDocument, admin: boolean, mp: MpForms): string {
  switch (doc.status) {
    case 'do_podpisu':
      return admin ? 'Czeka na Twój podpis. Pobierz w paczce ZIP albo pojedynczo.' : `Czeka na podpis ${mp.genitive}.`;
    case 'pobrany':
      return admin ? 'Pobrany w paczce. Po podpisaniu wgraj podpisany plik.' : `Pobrany w paczce - czeka na podpis ${mp.genitive}.`;
    case 'do_poprawy':
      return 'Zwrócony do poprawy. Wgraj nową wersję oryginału.';
    case 'podpisany':
      return doc.requires_signature ? 'Podpisany. Gotowy do wysyłki.' : 'Załącznik bez podpisu - gotowy do wysyłki.';
    case 'wyslany':
      return 'Oznaczony jako wysłany.';
    case 'anulowany':
      return 'Anulowany. Pliki zostaną usunięte automatycznie po 30 dniach.';
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

export default function DokumentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const role = profile?.role;
  const admin = isAdmin(role);
  const actor = { userId: user?.id, role };
  const mp = useMpForms();
  const moduleNarrow = useModuleNarrow('md');

  const { data: doc, isLoading } = useSigningDocument(id);
  const { data: batches = [] } = useDocumentBatches(id, admin);
  const { data: linkedCase } = useCase(doc?.case_id ?? null);
  const { data: users = [] } = useAssignableUsers();
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.full_name ?? null;
  const download = useDownloadSigningFile();

  const [preview, setPreview] = useState<SigningFile | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [signedOpen, setSignedOpen] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isLoading) {
    return (
      <Page>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg @max-md:hidden" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
        <div className="grid gap-5 @lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </Page>
    );
  }

  if (!doc) {
    return (
      <Page narrow>
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FileX2 className="h-5 w-5" />
          </div>
          <p className="text-sm text-muted-foreground">Nie znaleziono dokumentu lub nie masz do niego dostępu.</p>
          <Button size="sm" asChild>
            <Link to="/biuro/dokumenty">Wróć do listy</Link>
          </Button>
        </div>
      </Page>
    );
  }

  const { original, signature } = currentFiles(doc);
  const files = [...(doc.files ?? [])].sort((a, b) => b.version - a.version || b.created_at.localeCompare(a.created_at));
  const olderFiles = files.filter((f) => !f.is_current);

  const saveFile = async (file: SigningFile) => {
    try {
      await download.mutateAsync({ storagePath: file.storage_path, filename: downloadFilename(doc, file) });
    } catch (err) {
      toast.error('Nie udało się pobrać pliku', { description: errorMessage(err) });
    }
  };

  const previewFile: PreviewFile | null = preview
    ? {
        id: preview.id,
        name: preview.filename,
        mimeType: preview.mime_type,
        details: `${SIGNING_FILE_KIND_LABELS[preview.kind]} v${preview.version} · ${formatFileSize(preview.size_bytes)}`,
        load: () => fetchSigningFileBlob(preview.storage_path),
      }
    : null;

  const fileRow = (file: SigningFile) => (
    <li key={file.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm" title={file.filename}>
          {file.filename}
        </p>
        <p className="text-xs text-muted-foreground">
          {SIGNING_FILE_KIND_LABELS[file.kind]} · v{file.version} · {formatFileSize(file.size_bytes)} ·{' '}
          {format(new Date(file.created_at), 'd MMM yyyy, HH:mm', { locale: pl })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setPreview(file)}>
          <Eye />
          <span className="@max-sm:sr-only">Podgląd</span>
        </Button>
        <Button variant="ghost" size="sm" disabled={download.isPending} onClick={() => void saveFile(file)}>
          <Download />
          <span className="@max-sm:sr-only">Pobierz</span>
        </Button>
      </div>
    </li>
  );

  const actions = {
    batch: canBatchDocument(doc, actor),
    rebatch: admin && Boolean(doc.last_batch_id),
    sign: canAttachSigned(doc, actor),
    mark: canMarkSent(doc, actor),
    ret: canReturnDocument(doc, actor),
    replace: canReplaceOriginal(doc, actor),
    edit: canUpdateDocument(doc, actor),
    cancel: canCancelDocument(doc, actor),
    remove: canDeleteDocument(actor),
  };

  return (
    <Page>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link to="/biuro/dokumenty">
          <ArrowLeft />
          Dokumenty do podpisu
        </Link>
      </Button>
      <PageHeader
        icon={moduleNarrow ? undefined : FileSignature}
        title={<span className="whitespace-normal break-words">{doc.title}</span>}
        description={
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <SigningStatusBadge document={doc} />
            <span className="font-mono">{doc.code}</span>
            <span>wersja {doc.current_version}</span>
            {!doc.requires_signature && <Badge variant="muted">bez podpisu</Badge>}
            <span>Autor: {nameOf(doc.created_by) ?? '-'}</span>
            <DueDate document={doc} />
          </span>
        }
      />

      <div className="grid gap-5 @lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          {doc.status === 'do_poprawy' && doc.return_notes && (
            <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
                <MessageSquareText className="h-4 w-4" aria-hidden />
                Uwagi do poprawy
              </h2>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">{doc.return_notes}</p>
            </section>
          )}

          <section className="rounded-xl border bg-card p-4 shadow-card">
            <h2 className="text-sm font-semibold">Dane dokumentu</h2>
            <dl className="mt-3 grid gap-3 @sm:grid-cols-2">
              <Field label="Adresat">{doc.recipient_name ?? '-'}</Field>
              <Field label="Termin">
                {doc.due_date ? format(parseISO(doc.due_date), 'd MMMM yyyy', { locale: pl }) : '-'}
              </Field>
              <Field label="Powiązana sprawa">
                {doc.case_id ? (
                  <Link
                    to={`/biuro/sprawy?open=${encodeURIComponent(doc.case_id)}`}
                    className="inline-flex items-center gap-1 text-primary hover:underline max-md:min-h-10"
                  >
                    <Briefcase className="h-3.5 w-3.5 shrink-0" />
                    {linkedCase?.title ?? 'Otwórz sprawę'}
                  </Link>
                ) : (
                  '-'
                )}
              </Field>
              {doc.description && (
                <div className="@sm:col-span-2">
                  <Field label={`Notatka dla ${mp.genitive}`}>
                    <span className="whitespace-pre-wrap">{doc.description}</span>
                  </Field>
                </div>
              )}
              {(doc.send_subject || doc.send_text) && (
                <div className="space-y-3 rounded-lg bg-muted/40 p-3 @sm:col-span-2">
                  <Field label="Temat wysyłki">{doc.send_subject ?? '-'}</Field>
                  {doc.send_text && (
                    <Field label="Treść wiadomości">
                      <span className="whitespace-pre-wrap">{doc.send_text}</span>
                    </Field>
                  )}
                </div>
              )}
              {doc.sent_note && (
                <div className="@sm:col-span-2">
                  <Field label="Notatka o wysyłce">
                    <span className="whitespace-pre-wrap">{doc.sent_note}</span>
                  </Field>
                </div>
              )}
            </dl>
          </section>

          <section className="overflow-hidden rounded-xl border bg-card shadow-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Pliki</h2>
            {!original && !signature ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {doc.status === 'anulowany' ? 'Pliki anulowanego dokumentu zostały usunięte.' : 'Brak plików.'}
              </p>
            ) : (
              <ul className="divide-y">
                {original && fileRow(original)}
                {signature && fileRow(signature)}
              </ul>
            )}
            {olderFiles.length > 0 && (
              <details className="border-t">
                <summary className="flex min-h-11 cursor-pointer items-center px-4 text-xs font-medium text-muted-foreground hover:text-foreground">
                  Poprzednie wersje i podpisy ({olderFiles.length})
                </summary>
                <ul className="divide-y border-t bg-muted/20">{olderFiles.map(fileRow)}</ul>
              </details>
            )}
          </section>

          <section className="rounded-xl border bg-card p-4 shadow-card">
            <h2 className="mb-4 text-sm font-semibold">Historia</h2>
            <DocumentTimeline document={doc} batches={batches} nameOf={nameOf} />
          </section>
        </div>

        <aside className="space-y-4 @lg:sticky @lg:top-4 @lg:self-start">
          <section className="rounded-xl border bg-card p-4 shadow-card">
            <h2 className="text-sm font-semibold">Działania</h2>
            <p className="mt-1 text-xs text-muted-foreground">{stageDescription(doc, admin, mp)}</p>
            <div className="mt-4 grid gap-2">
              {actions.batch && (
                <DownloadBatchButton documents={[doc]} variant="default" size="default" label="Pobierz do podpisu (ZIP)" />
              )}
              {actions.sign && (
                <Button variant={actions.batch ? 'outline' : 'default'} onClick={() => setSignedOpen(true)}>
                  <FileSignature />
                  {signature ? 'Wgraj nowy podpis' : 'Wgraj podpisany'}
                </Button>
              )}
              {actions.mark && (
                <Button onClick={() => setMarkOpen(true)}>
                  <MailCheck />
                  Oznacz jako wysłany
                </Button>
              )}
              {actions.ret && (
                <Button variant="outline" onClick={() => setReturnOpen(true)}>
                  <Undo2 />
                  Zwróć do poprawy
                </Button>
              )}
              {actions.replace && (
                <Button variant={doc.status === 'do_poprawy' ? 'default' : 'outline'} onClick={() => setReplaceOpen(true)}>
                  <FilePlus2 />
                  Wgraj nową wersję
                </Button>
              )}
              {actions.edit && (
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil />
                  Edytuj dane
                </Button>
              )}
              {actions.rebatch && doc.last_batch_id && (
                <DownloadBatchButton batchId={doc.last_batch_id} variant="ghost" size="default" />
              )}
              {(actions.cancel || actions.remove) && <div className="my-1 h-px bg-border" aria-hidden />}
              {actions.cancel && (
                <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setCancelOpen(true)}>
                  <Ban />
                  Anuluj dokument
                </Button>
              )}
              {actions.remove && (
                <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 />
                  Usuń
                </Button>
              )}
              {download.isPending && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Pobieranie…
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>

      <FilePreviewDialog
        file={previewFile}
        onClose={() => setPreview(null)}
        onDownload={() => preview && void saveFile(preview)}
        downloading={download.isPending}
      />
      <EditDocumentDialog document={editOpen ? doc : null} onClose={() => setEditOpen(false)} />
      <ReplaceOriginalDialog document={replaceOpen ? doc : null} onClose={() => setReplaceOpen(false)} />
      {admin && <SignedUploadDialog open={signedOpen} onOpenChange={setSignedOpen} document={doc} />}
      <MarkSentDialog documents={markOpen ? [doc] : []} onClose={() => setMarkOpen(false)} />
      <ReturnDialog documents={returnOpen ? [doc] : []} onClose={() => setReturnOpen(false)} />
      <CancelDocumentDialog document={cancelOpen ? doc : null} onClose={() => setCancelOpen(false)} />
      <DeleteDocumentDialog
        document={deleteOpen ? doc : null}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => navigate('/biuro/dokumenty', { replace: true })}
      />
    </Page>
  );
}

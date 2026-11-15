import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileQuestion, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Dynamiczny import: pdf.js (~0,5 MB + worker) trafia do osobnego chunka, ładowanego dopiero przy PDF.
const PdfViewer = lazy(() => import('./PdfViewer'));

export interface PreviewFile {
  /** Stały identyfikator pliku (klucz cache). */
  id: string;
  name: string;
  mimeType: string;
  /** Dodatkowy opis pod nazwą (np. rozmiar). */
  details?: string;
  load: () => Promise<Blob>;
}

type PreviewKind = 'pdf' | 'image' | 'text' | 'docx' | 'none';

type Preview =
  | { kind: 'pdf'; blob: Blob }
  | { kind: 'image'; blob: Blob }
  | { kind: 'text'; text: string }
  | { kind: 'html'; html: string };

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

/** Typ podglądu z MIME, a przy pustym lub ogólnym MIME z rozszerzenia nazwy. */
function previewKind(mimeType: string, name: string): PreviewKind {
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (IMAGE_MIMES.includes(mimeType) || IMAGE_EXTS.includes(ext)) return 'image';
  if (mimeType === 'text/plain' || ext === 'txt') return 'text';
  if (mimeType === DOCX_MIME || ext === 'docx') return 'docx';
  return 'none';
}

/** Polskie pliki .txt bywają w Windows-1250: UTF-8 sprawdzamy ściśle i dopiero wtedy cofamy się. */
function decodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1250').decode(buffer);
  }
}

async function buildPreview(file: PreviewFile, kind: Exclude<PreviewKind, 'none'>): Promise<Preview> {
  const blob = await file.load();
  switch (kind) {
    case 'pdf':
      return { kind: 'pdf', blob };
    case 'image':
      return { kind: 'image', blob };
    case 'text':
      return { kind: 'text', text: decodeText(await blob.arrayBuffer()) };
    case 'docx': {
      // Dynamiczny import: mammoth (~0,6 MB) ładowany tylko przy podglądzie .docx, jak xlsx w csv-import.
      const { default: mammoth } = await import('mammoth');
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
      return { kind: 'html', html: value };
    }
  }
}

// Treść z pliku użytkownika: bez skryptów i zasobów z sieci; obrazy z .docx są osadzone jako data:.
const DOC_HEAD =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">` +
  '<style>body{max-width:820px;margin:0 auto;padding:32px 24px;font:15px/1.6 system-ui,sans-serif;color:#1a1a1a;background:#fff;overflow-wrap:break-word}' +
  'img{max-width:100%;height:auto}table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #ccc;padding:4px 8px;vertical-align:top}</style>';

function ImagePreview({ blob, alt }: { blob: Blob; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  if (!url) return null;
  return (
    <div className="flex min-h-full items-center justify-center p-3">
      <img src={url} alt={alt} className="max-w-full rounded-md bg-white object-contain shadow-card" />
    </div>
  );
}

interface MessageProps {
  text: string;
  onDownload: () => void;
  downloading: boolean;
}

function Message({ text, onDownload, downloading }: MessageProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <FileQuestion className="h-5 w-5" />
      </div>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      <Button type="button" size="sm" disabled={downloading} onClick={onDownload}>
        {downloading ? <Loader2 className="animate-spin" /> : <Download />}
        Pobierz plik
      </Button>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

interface Props {
  file: PreviewFile | null;
  onClose: () => void;
  onDownload: () => void;
  downloading: boolean;
}

/** Podgląd załącznika bez pobierania: PDF (pdf.js), obrazy, .txt i .docx; inne typy proponują pobranie. */
export function FilePreviewDialog({ file, onClose, onDownload, downloading }: Props) {
  const kind = file ? previewKind(file.mimeType, file.name) : 'none';
  const { data, isError } = useQuery({
    queryKey: ['file-preview', file?.id],
    queryFn: () => buildPreview(file!, kind as Exclude<PreviewKind, 'none'>),
    enabled: Boolean(file) && kind !== 'none',
    staleTime: Infinity,
    // Pliki do 10 MB: nie trzymamy ich w pamięci po zamknięciu podglądu.
    gcTime: 0,
  });

  const message = (text: string) => <Message text={text} onDownload={onDownload} downloading={downloading} />;

  let body;
  if (kind === 'none') {
    body = message('Tego typu pliku nie da się wyświetlić w aplikacji. Pobierz go albo zapisz jako PDF lub .docx.');
  } else if (isError) {
    body = message('Nie udało się wczytać podglądu.');
  } else if (!data) {
    body = <Spinner />;
  } else if (data.kind === 'pdf') {
    body = (
      <Suspense fallback={<Spinner />}>
        <PdfViewer
          blob={data.blob}
          fallback={message('Nie udało się otworzyć PDF (plik uszkodzony albo chroniony hasłem).')}
        />
      </Suspense>
    );
  } else if (data.kind === 'image') {
    body = <ImagePreview blob={data.blob} alt={file?.name ?? ''} />;
  } else if (data.kind === 'text') {
    body = (
      <pre className="m-3 whitespace-pre-wrap break-words rounded-md bg-card p-4 font-mono text-sm leading-6 shadow-card">
        {data.text}
      </pre>
    );
  } else {
    body = (
      <iframe
        sandbox=""
        srcDoc={DOC_HEAD + data.html}
        title={`Podgląd: ${file?.name ?? ''}`}
        className="block h-full w-full bg-white"
      />
    );
  }

  return (
    <Dialog open={Boolean(file)} onOpenChange={(o) => !o && onClose()}>
      {file && (
        <DialogContent className="flex h-[92dvh] max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl max-md:overflow-hidden max-md:pb-[env(safe-area-inset-bottom)]">
          <DialogHeader className="flex-row items-center gap-3 border-b px-4 py-3 pr-14 max-md:pr-14">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base" title={file.name}>
                {file.name}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {file.details ? `Podgląd · ${file.details}` : 'Podgląd'}
              </DialogDescription>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={downloading} onClick={onDownload}>
              {downloading ? <Loader2 className="animate-spin" /> : <Download />}
              <span className="max-sm:sr-only">Pobierz</span>
            </Button>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-muted/40">{body}</div>
        </DialogContent>
      )}
    </Dialog>
  );
}

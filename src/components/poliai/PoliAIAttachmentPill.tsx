import { AlertCircle, File as FileIcon, FileText, FileType, ImageIcon, Loader2, X, type LucideIcon } from 'lucide-react';
import type { PoliAIAttachmentStatus } from '@/hooks/usePoliAIAttachments';
import type { AttachmentBlock, AttachmentKind } from '@/lib/poliai';
import { attachmentMeta } from '@/lib/poliaiFiles';
import { cn } from '@/lib/utils';

const KIND_ICONS: Record<AttachmentKind, LucideIcon> = {
  image: ImageIcon,
  pdf: FileText,
  docx: FileType,
  text: FileIcon,
};

const STATUS_LABELS: Partial<Record<PoliAIAttachmentStatus, string>> = {
  processing: 'Kompresuję…',
  uploading: 'Wysyłam…',
  reading: 'Odczytuję tekst…',
};

interface PoliAIAttachmentPillProps {
  name: string;
  kind?: AttachmentKind;
  /** Gotowy załącznik - opis `PDF · 3 str. · 420 KB`. */
  block?: AttachmentBlock;
  status?: PoliAIAttachmentStatus;
  error?: string;
  onOpen?: () => void;
  onRemove?: () => void;
}

/** Pastylka załącznika: w composerze (status, usuwanie) i nad wiadomością użytkownika (podgląd). */
export function PoliAIAttachmentPill({ name, kind, block, status = 'ready', error, onOpen, onRemove }: PoliAIAttachmentPillProps) {
  const failed = status === 'error';
  const statusLabel = STATUS_LABELS[status];
  const Icon = failed ? AlertCircle : statusLabel ? Loader2 : KIND_ICONS[block?.kind ?? kind ?? 'text'];
  const meta = failed ? 'Błąd' : (statusLabel ?? (block ? attachmentMeta(block) : ''));

  const content = (
    <>
      <Icon
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          failed ? 'text-destructive' : 'text-muted-foreground',
          statusLabel && 'animate-spin',
        )}
        aria-hidden
      />
      <span className="max-w-[180px] truncate font-medium">{name}</span>
      {meta && <span className={cn('shrink-0', failed ? 'text-destructive' : 'text-muted-foreground')}>{meta}</span>}
    </>
  );

  return (
    <div
      title={failed ? error : name}
      className={cn(
        'inline-flex max-w-full items-center rounded-full border bg-card text-xs shadow-sm',
        failed && 'border-destructive/40 bg-destructive/5',
      )}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Podgląd: ${name}`}
          className="inline-flex min-w-0 items-center gap-1.5 rounded-full py-1.5 pl-2.5 pr-3 transition-colors hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:py-2"
        >
          {content}
        </button>
      ) : (
        <span className={cn('inline-flex min-w-0 items-center gap-1.5 py-1.5 pl-2.5 max-md:py-2', onRemove ? 'pr-1' : 'pr-3')}>
          {content}
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Usuń załącznik ${name}`}
          className="mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-7 max-md:w-7"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

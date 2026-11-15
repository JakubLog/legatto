import { Link } from 'react-router-dom';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { pl } from 'date-fns/locale';
import { FileText, MessageSquareText } from 'lucide-react';
import { SigningStatusBadge } from '@/components/signing/SigningStatusBadge';
import { cn } from '@/lib/utils';
import { currentFiles, fileExtension, type SigningDocument, type SigningStatus } from '@/lib/signing';

/** Wspólny szablon kolumn nagłówka i wierszy (szeroki obszar modułu). */
export const SIGNING_COLUMNS =
  '@md:grid @md:grid-cols-[1.75rem_minmax(0,1fr)_10rem_9rem_6.5rem] @lg:grid-cols-[1.75rem_minmax(0,1fr)_11rem_11rem_7.5rem]';

/** Statusy, w których termin jeszcze obowiązuje (dokument nie wyszedł z biura). */
const DUE_RELEVANT: SigningStatus[] = ['do_podpisu', 'pobrany', 'do_poprawy', 'podpisany'];

export function DueDate({ document, className }: { document: Pick<SigningDocument, 'due_date' | 'status'>; className?: string }) {
  if (!document.due_date) return null;
  const due = parseISO(document.due_date);
  const days = differenceInCalendarDays(due, new Date());
  const pending = DUE_RELEVANT.includes(document.status);
  return (
    <span
      title={`Termin: ${format(due, 'd MMMM yyyy', { locale: pl })}`}
      className={cn(
        'whitespace-nowrap text-xs',
        pending && days < 0 ? 'font-medium text-destructive' : pending && days <= 2 ? 'text-amber-700' : 'text-muted-foreground',
        className,
      )}
    >
      termin {format(due, 'd MMM', { locale: pl })}
      {pending && days < 0 && ' (po terminie)'}
    </span>
  );
}

interface Props {
  document: SigningDocument;
  authorName: string | null;
  /** Wiersz można zaznaczyć (Poseł/administrator - akcje zbiorcze). */
  selectable: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
}

export function SigningRow({ document: doc, authorName, selectable, selected, onToggle }: Props) {
  const { original } = currentFiles(doc);
  const ext = original ? fileExtension(original.storage_path).toUpperCase() : null;
  return (
    <li
      className={cn(
        'group relative flex min-h-11 items-start gap-3 border-b px-4 py-2.5 transition-colors last:border-b-0 hover:bg-muted/60 @md:items-center',
        selected && 'bg-primary/5',
        SIGNING_COLUMNS,
      )}
    >
      <div className="relative z-10 flex h-11 w-7 shrink-0 items-center justify-center @md:h-auto">
        {selectable && (
          <input
            type="checkbox"
            aria-label={`Zaznacz ${doc.code}`}
            className="h-4 w-4 rounded border-input accent-primary max-md:h-5 max-md:w-5"
            checked={selected}
            onChange={() => onToggle(doc.id)}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 @md:hidden">
          <SigningStatusBadge document={doc} />
          <DueDate document={doc} />
        </div>
        <Link
          to={`/biuro/dokumenty/${doc.id}`}
          className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline @max-md:line-clamp-2 @max-md:whitespace-normal @max-md:break-words @max-md:text-[15px] @max-md:leading-snug"
        >
          {doc.title}
        </Link>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{doc.code}</span>
          {doc.current_version > 1 && <span>v{doc.current_version}</span>}
          {ext && (
            <span className="inline-flex items-center gap-0.5">
              <FileText className="h-3 w-3" aria-hidden />
              {ext}
            </span>
          )}
          {doc.recipient_name && (
            <span className="min-w-0 truncate @max-md:whitespace-normal @max-md:break-words">do: {doc.recipient_name}</span>
          )}
          {!doc.requires_signature && <span>bez podpisu</span>}
        </div>
        {doc.status === 'do_poprawy' && doc.return_notes && (
          <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
            <MessageSquareText className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span className="line-clamp-2 break-words">{doc.return_notes}</span>
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground @md:hidden">
          {authorName ?? 'Autor nieznany'} · {format(new Date(doc.created_at), 'd MMM yyyy', { locale: pl })}
        </p>
      </div>

      <div className="hidden min-w-0 @md:block">
        <SigningStatusBadge document={doc} />
      </div>
      <span className="hidden truncate text-[13px] @md:block">{authorName ?? '-'}</span>
      <div className="hidden min-w-0 flex-col text-[13px] text-muted-foreground @md:flex">
        <span>{format(new Date(doc.created_at), 'd MMM yyyy', { locale: pl })}</span>
        <DueDate document={doc} />
      </div>
    </li>
  );
}

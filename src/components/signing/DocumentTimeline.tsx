import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { Ban, FileArchive, FilePlus2, FileSignature, MailCheck, Undo2, type LucideIcon } from 'lucide-react';
import type { SigningBatchEntry } from '@/hooks/useSigningDocuments';
import type { SigningDocument } from '@/lib/signing';

interface TimelineEvent {
  key: string;
  at: string;
  icon: LucideIcon;
  label: string;
  actor?: string | null;
  detail?: ReactNode;
  tone?: 'danger';
}

interface Props {
  document: SigningDocument;
  /** Paczki ZIP z dokumentem (widoczne tylko dla Posła/administratora). */
  batches: SigningBatchEntry[];
  nameOf: (userId: string | null) => string | null;
}

/** Oś czasu obiegu dokumentu w portalu. */
export function DocumentTimeline({ document: doc, batches, nameOf }: Props) {
  const events: TimelineEvent[] = [
    { key: 'created', at: doc.created_at, icon: FilePlus2, label: 'Dodano dokument', actor: nameOf(doc.created_by) },
  ];
  for (const file of doc.files ?? []) {
    if (file.kind === 'oryginal' && file.version > 1) {
      events.push({ key: file.id, at: file.created_at, icon: FilePlus2, label: `Nowa wersja v${file.version}`, actor: nameOf(file.created_by) });
    } else if (file.kind !== 'oryginal') {
      events.push({
        key: file.id,
        at: file.created_at,
        icon: FileSignature,
        label: `Wgrano ${file.kind === 'podpis_zewnetrzny' ? 'podpis zewnętrzny' : 'podpisany plik'} (v${file.version})`,
        actor: nameOf(file.created_by),
      });
    }
  }
  for (const entry of batches) {
    if (!entry.batch) continue;
    events.push({
      key: `batch-${entry.batch_id}`,
      at: entry.batch.created_at,
      icon: FileArchive,
      label: `Pobrano w paczce ${entry.batch.code}`,
      actor: nameOf(entry.batch.created_by),
      detail: <span className="font-mono">{entry.zip_name}</span>,
    });
  }
  if (doc.status === 'do_poprawy' && doc.return_notes) {
    events.push({
      key: 'returned',
      at: doc.updated_at,
      icon: Undo2,
      label: 'Zwrócono do poprawy',
      detail: <span className="whitespace-pre-wrap">{doc.return_notes}</span>,
      tone: 'danger',
    });
  }
  if (doc.sent_at) {
    events.push({
      key: 'sent',
      at: doc.sent_at,
      icon: MailCheck,
      label: 'Oznaczono jako wysłany',
      detail: doc.sent_note ? <span className="whitespace-pre-wrap">{doc.sent_note}</span> : undefined,
    });
  }
  if (doc.cancelled_at) events.push({ key: 'cancelled', at: doc.cancelled_at, icon: Ban, label: 'Anulowano', tone: 'danger' });

  events.sort((a, b) => b.at.localeCompare(a.at));

  return (
    <ol className="relative space-y-4 border-l pl-5">
      {events.map(({ key, at, icon: Icon, label, actor, detail, tone }) => (
        <li key={key} className="relative">
          <span
            className={`absolute -left-[1.95rem] flex h-6 w-6 items-center justify-center rounded-full border bg-card ${tone === 'danger' ? 'text-destructive' : 'text-primary'}`}
            aria-hidden
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">
            <time dateTime={at}>{format(new Date(at), 'd MMMM yyyy, HH:mm', { locale: pl })}</time>
            {actor && ` · ${actor}`}
          </p>
          {detail && <p className="mt-1 break-words text-xs text-muted-foreground">{detail}</p>}
        </li>
      ))}
    </ol>
  );
}

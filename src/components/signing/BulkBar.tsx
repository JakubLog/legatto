import { CheckCheck, Undo2, X, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DownloadBatchButton } from '@/components/signing/DownloadBatchButton';
import {
  canBatchDocument,
  canMarkSent,
  canReturnDocument,
  type SigningActor,
  type SigningDocument,
} from '@/lib/signing';

interface Props {
  selected: SigningDocument[];
  actor: SigningActor;
  onMarkSent: (docs: SigningDocument[]) => void;
  onReturn: (docs: SigningDocument[]) => void;
  onClear: () => void;
}

/**
 * Pasek akcji zbiorczych. `sticky` w przewijanym `<main>`: trzyma się dołu obszaru modułu
 * (na telefonie nad BottomNav, bo `<main>` kończy się nad nią). Każda akcja dotyczy tylko
 * zaznaczonych dokumentów, które są w odpowiednim statusie - licznik w nawiasie.
 */
export function BulkBar({ selected, actor, onMarkSent, onReturn, onClear }: Props) {
  const batchable = selected.filter((d) => canBatchDocument(d, actor));
  const markable = selected.filter((d) => canMarkSent(d, actor));
  const returnable = selected.filter((d) => canReturnDocument(d, actor));

  return (
    <div
      role="toolbar"
      aria-label="Akcje zbiorcze"
      className="sticky bottom-2 z-40 flex justify-center animate-in fade-in-0 slide-in-from-bottom-4 md:bottom-6"
    >
      <div className="flex max-w-full flex-wrap items-center gap-1 rounded-xl border bg-popover p-1.5 pl-3 text-popover-foreground shadow-lg">
        <span className="mr-1 inline-flex items-center gap-2 text-sm font-medium">
          <CheckCheck className="h-4 w-4 text-primary" aria-hidden />
          <span className="tabular-nums">{selected.length}</span>
          <span className="@max-sm:sr-only">zaznaczonych</span>
        </span>
        <span aria-hidden className="mx-1 h-6 w-px bg-border" />
        {batchable.length > 0 && (
          <DownloadBatchButton
            documents={batchable}
            variant="ghost"
            label={`Pobierz paczkę ZIP (${batchable.length})`}
            onDone={onClear}
          />
        )}
        {markable.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onMarkSent(markable)}>
            <MailCheck />
            <span className="@max-sm:sr-only">Oznacz jako wysłane</span> ({markable.length})
          </Button>
        )}
        {returnable.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onReturn(returnable)}>
            <Undo2 />
            <span className="@max-sm:sr-only">Zwróć do poprawy</span> ({returnable.length})
          </Button>
        )}
        {batchable.length + markable.length + returnable.length === 0 && (
          <span className="px-2 text-xs text-muted-foreground">Brak akcji dla zaznaczonych statusów</span>
        )}
        <span aria-hidden className="mx-1 h-6 w-px bg-border" />
        <Button variant="ghost" size="sm" onClick={onClear} aria-label="Wyczyść zaznaczenie" title="Wyczyść zaznaczenie">
          <X />
        </Button>
      </div>
    </div>
  );
}

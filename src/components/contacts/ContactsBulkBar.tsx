import { CheckCheck, Loader2, MapPin, PenLine, Tag, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type BulkAction = 'delete' | 'edit-fields' | 'change-type' | 'change-region';

interface Props {
  count: number;
  total: number;
  canWrite: boolean;
  canDelete: boolean;
  /** Trwa pobieranie id wszystkich kontaktów pasujących do filtrów. */
  selectingAll: boolean;
  /** Zaznacza wszystkie kontakty z wyników (wszystkie strony); brak gdy już są zaznaczone. */
  onSelectAll?: () => void;
  onAction: (action: BulkAction) => void;
  onClear: () => void;
}

/**
 * Pływający pasek akcji zbiorczych (w stylu ClickUp) - widoczny gdy zaznaczono kontakty.
 * `sticky` w przewijanym `<main>`: trzyma się dołu obszaru modułu (nie wchodzi pod panel PoliAI)
 * i jest wyśrodkowany względem treści modułu. Na wąskim module akcje pokazują same ikony.
 */
export function ContactsBulkBar({
  count,
  total,
  canWrite,
  canDelete,
  selectingAll,
  onSelectAll,
  onAction,
  onClear,
}: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Akcje zbiorcze"
      className="sticky bottom-6 z-40 hidden justify-center animate-in fade-in-0 slide-in-from-bottom-4 md:flex"
    >
      <div className="flex max-w-full flex-wrap items-center gap-1 rounded-xl border bg-popover p-1.5 pl-3 text-popover-foreground shadow-lg">
        <span className="mr-2 inline-flex items-center gap-2 text-sm font-medium">
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
            {count}
          </span>
          <span className="text-muted-foreground">z {total} zaznaczonych</span>
        </span>
        <span aria-hidden className="mx-1 h-6 w-px bg-border" />
        {onSelectAll && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSelectAll}
              disabled={selectingAll}
              title="Zaznacz wszystkie kontakty"
            >
              {selectingAll ? <Loader2 className="animate-spin" /> : <CheckCheck />}
              <span className="@max-lg:sr-only">Zaznacz wszystkie kontakty</span>
            </Button>
            <span aria-hidden className="mx-1 h-6 w-px bg-border" />
          </>
        )}
        {canWrite && (
          <Button variant="ghost" size="sm" onClick={() => onAction('edit-fields')} title="Edytuj pola">
            <PenLine />
            <span className="@max-lg:sr-only">Edytuj pola</span>
          </Button>
        )}
        {canWrite && (
          <Button variant="ghost" size="sm" onClick={() => onAction('change-type')} title="Zmień typ">
            <Tag />
            <span className="@max-lg:sr-only">Zmień typ</span>
          </Button>
        )}
        {canWrite && (
          <Button variant="ghost" size="sm" onClick={() => onAction('change-region')} title="Zmień region">
            <MapPin />
            <span className="@max-lg:sr-only">Zmień region</span>
          </Button>
        )}
        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onAction('delete')}
            title="Usuń"
          >
            <Trash2 />
            <span className="@max-lg:sr-only">Usuń</span>
          </Button>
        )}
        <span aria-hidden className="mx-1 h-6 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClear}
          aria-label="Wyczyść zaznaczenie"
          title="Wyczyść zaznaczenie"
        >
          <X />
        </Button>
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { SIGNING_COLUMNS, SigningRow } from '@/components/signing/SigningRow';
import { cn } from '@/lib/utils';
import type { SigningDocument } from '@/lib/signing';

interface Props {
  documents: SigningDocument[];
  isLoading: boolean;
  /** Zaznaczanie wierszy (akcje zbiorcze) - tylko Poseł/administrator. */
  selectable: boolean;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[], select: boolean) => void;
  authorName: (userId: string | null) => string | null;
  emptyState: ReactNode;
}

export function SigningList({
  documents,
  isLoading,
  selectable,
  selectedIds,
  onToggle,
  onToggleAll,
  authorName,
  emptyState,
}: Props) {
  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="hidden h-5 w-20 rounded-full @md:block" />
            <Skeleton className="hidden h-4 w-24 @lg:block" />
          </div>
        ))}
      </div>
    );
  }

  if (documents.length === 0) return <>{emptyState}</>;

  const ids = documents.map((d) => d.id);
  const selectedHere = ids.filter((id) => selectedIds.has(id)).length;
  const allSelected = selectedHere === ids.length;

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div
        className={cn(
          'flex items-center gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground @max-md:hidden',
          SIGNING_COLUMNS,
        )}
      >
        <span className="flex w-7 justify-center">
          {selectable && (
            <input
              type="checkbox"
              aria-label={allSelected ? 'Odznacz wszystkie' : 'Zaznacz wszystkie widoczne'}
              className="h-4 w-4 rounded border-input accent-primary"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selectedHere > 0 && !allSelected;
              }}
              onChange={() => onToggleAll(ids, !allSelected)}
            />
          )}
        </span>
        <span>Dokument</span>
        <span>Status</span>
        <span>Autor</span>
        <span>Dodano</span>
      </div>
      {selectable && (
        // Wąski obszar: zaznaczenie wszystkich nad listą (nagłówek kolumn jest ukryty).
        <label className="flex min-h-11 items-center gap-3 border-b px-4 text-sm text-muted-foreground @md:hidden">
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-input accent-primary"
            checked={allSelected}
            onChange={() => onToggleAll(ids, !allSelected)}
          />
          {allSelected ? 'Odznacz wszystkie' : 'Zaznacz wszystkie widoczne'}
        </label>
      )}
      <ul>
        {documents.map((doc) => (
          <SigningRow
            key={doc.id}
            document={doc}
            authorName={authorName(doc.created_by)}
            selectable={selectable}
            selected={selectedIds.has(doc.id)}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </div>
  );
}

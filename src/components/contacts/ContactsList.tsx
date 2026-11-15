import { useMemo, useRef, useState } from 'react';
import { ChevronRight, Loader2, Mail, Phone, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ContactWithRelations } from '@/integrations/supabase/types';
import { canWrite, isAdmin } from '@/lib/permissions';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAllContactIds, type ContactsFilters } from '@/hooks/useContacts';
import { useIsMobile } from '@/hooks/useIsMobile';
import { mailtoHref } from '@/lib/mailto';
import { BulkChangeRegionDialog } from './BulkChangeRegionDialog';
import { BulkChangeTypeDialog } from './BulkChangeTypeDialog';
import { BulkDeleteContactsDialog } from './BulkDeleteContactsDialog';
import { BulkEditContactsDialog } from './BulkEditContactsDialog';
import { ContactAvatar, ContactTypePill } from './ContactAtoms';
import { ContactsBulkBar, type BulkAction } from './ContactsBulkBar';
import { ContactsTable, type SortKey, type SortState } from './ContactsTable';

interface Props {
  contacts: ContactWithRelations[];
  /** Liczba wszystkich kontaktów pasujących do filtrów (wszystkie strony). */
  total: number;
  /** Aktywne filtry - zakres „Zaznacz wszystkie kontakty”; zmiana czyści zaznaczenie. */
  filters: ContactsFilters;
  isLoading: boolean;
  /** Czy aktywny jest jakikolwiek filtr (inny komunikat pustego stanu). */
  filtered: boolean;
  onOpen: (c: ContactWithRelations) => void;
  onAdd?: () => void;
  onEdit: (c: ContactWithRelations) => void;
  onDelete: (c: ContactWithRelations) => void;
}

function getSortValue(c: ContactWithRelations, col: SortKey): string {
  switch (col) {
    case 'osoba':
      return `${c.last_name} ${c.first_name}`.toLocaleLowerCase('pl-PL');
    case 'typ':
      return c.type;
    case 'telefon':
      return c.phone ?? '';
    case 'email':
      return c.email ?? '';
    case 'lokalizacja':
      return [c.powiat?.name, c.gmina?.name, c.miejscowosc].filter(Boolean).join(' ');
  }
}

function compareContacts(
  a: ContactWithRelations,
  b: ContactWithRelations,
  sort: SortState,
): number {
  const cmp = getSortValue(a, sort.col).localeCompare(getSortValue(b, sort.col), 'pl-PL');
  return sort.dir === 'asc' ? cmp : -cmp;
}

export function ContactsList({ contacts, total, filters, isLoading, filtered, onOpen, onAdd, onEdit, onDelete }: Props) {
  const { profile } = useAuth();
  const writer = canWrite(profile?.role);
  const isMobile = useIsMobile();
  const admin = isAdmin(profile?.role);
  const showActions = writer || admin;

  const [sort, setSort] = useState<SortState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  /** Unieważnia trwające „Zaznacz wszystkie”, gdy w międzyczasie zmieniły się filtry. */
  const selectAllRun = useRef(0);

  // Zaznaczenie dotyczy konkretnego wyniku wyszukiwania - po zmianie filtrów zaczynamy od zera,
  // żeby akcja masowa nie objęła rekordów, których użytkownik już nie widzi.
  const filtersKey = JSON.stringify(filters);
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (prevFiltersKey !== filtersKey) {
    setPrevFiltersKey(filtersKey);
    setSelected(new Set());
    setSelectingAll(false);
    selectAllRun.current += 1;
  }

  const sortedContacts = useMemo(() => {
    if (!sort) return contacts;
    return [...contacts].sort((a, b) => compareContacts(a, b, sort));
  }, [contacts, sort]);

  const toggleSort = (col: SortKey) => {
    setSort(prev => {
      if (!prev || prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return null;
    });
  };

  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedOnPage = contacts.filter(c => selected.has(c.id)).length;
  const masterState: 'none' | 'some' | 'all' =
    selectedOnPage === 0 ? 'none' : selectedOnPage === contacts.length ? 'all' : 'some';
  const allSelected = total > 0 && selected.size >= total;

  // Nagłówek tabeli działa na bieżącej stronie; zaznaczenia z innych stron zostają.
  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (masterState === 'all') for (const c of contacts) next.delete(c.id);
      else for (const c of contacts) next.add(c.id);
      return next;
    });
  };

  const selectAllContacts = async () => {
    const run = ++selectAllRun.current;
    setSelectingAll(true);
    try {
      const ids = await fetchAllContactIds(filters);
      if (run === selectAllRun.current) setSelected(new Set(ids));
    } catch {
      if (run === selectAllRun.current) toast.error('Nie udało się zaznaczyć wszystkich kontaktów');
    } finally {
      if (run === selectAllRun.current) setSelectingAll(false);
    }
  };

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const clearSelection = () => setSelected(new Set());
  const showSelection = !isMobile && (writer || admin);

  if (isLoading) return <ContactsListSkeleton />;

  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Users className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          {filtered ? 'Brak kontaktów dla wybranych filtrów.' : 'Baza kontaktów jest pusta.'}
        </p>
        {!filtered && onAdd && (
          <Button size="sm" onClick={onAdd}>
            <Plus />
            Dodaj kontakt
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Mobile */}
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm md:hidden">
        {sortedContacts.map(c => {
          const emailHref = mailtoHref(c.email);
          return (
          <li key={c.id} className="flex items-center gap-1 pr-1.5">
            <button
              type="button"
              onClick={() => onOpen(c)}
              className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left transition-colors hover:bg-muted/60 active:bg-muted"
            >
              <ContactAvatar firstName={c.first_name} lastName={c.last_name} type={c.type} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {c.first_name} {c.last_name}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <ContactTypePill type={c.type} className="shrink-0 px-1.5 py-0 text-[11px]" />
                  <span className="truncate">
                    {[c.function, c.powiat?.name].filter(Boolean).join(' · ')}
                  </span>
                </div>
              </div>
              {!c.phone && !emailHref && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </button>
            {/* Szybkie akcje na telefonie: połączenie i e-mail bez otwierania szczegółów. */}
            {c.phone && (
              <a
                href={`tel:${c.phone}`}
                aria-label={`Zadzwoń: ${c.phone}`}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10 active:bg-primary/15"
              >
                <Phone className="h-4 w-4" />
              </a>
            )}
            {emailHref && (
              <a
                href={emailHref}
                aria-label={`Napisz e-mail: ${c.email}`}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10 active:bg-primary/15"
              >
                <Mail className="h-4 w-4" />
              </a>
            )}
          </li>
          );
        })}
      </ul>

      {/* Desktop */}
      {showSelection && total > contacts.length && (masterState === 'all' || allSelected) && (
        <div
          className="hidden flex-wrap items-center justify-center gap-2 rounded-lg border bg-muted/60 px-4 py-2 text-center text-sm md:flex"
          aria-live="polite"
        >
          {allSelected ? (
            <>
              <span>Zaznaczono wszystkie kontakty pasujące do wyszukiwania ({total}).</span>
              <Button variant="link" size="sm" className="h-auto p-0" onClick={clearSelection}>
                Wyczyść zaznaczenie
              </Button>
            </>
          ) : (
            <>
              <span>Zaznaczono wszystkie kontakty na tej stronie ({contacts.length}).</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={selectAllContacts}
                disabled={selectingAll}
              >
                {selectingAll && <Loader2 className="animate-spin" />}
                Zaznacz wszystkie kontakty ({total})
              </Button>
            </>
          )}
        </div>
      )}
      <ContactsTable
        contacts={sortedContacts}
        sort={sort}
        onSort={toggleSort}
        selected={selected}
        onToggleSelected={toggleSelected}
        onToggleAll={toggleAll}
        masterState={masterState}
        showSelection={showSelection}
        showActions={showActions}
        canEdit={writer}
        canDelete={admin}
        onOpen={onOpen}
        onEdit={onEdit}
        onDelete={onDelete}
      />

      {!isMobile && selected.size > 0 && (
        <ContactsBulkBar
          count={selected.size}
          total={total}
          canWrite={writer}
          canDelete={admin}
          selectingAll={selectingAll}
          onSelectAll={allSelected ? undefined : selectAllContacts}
          onAction={setBulkAction}
          onClear={clearSelection}
        />
      )}

      {!isMobile && (
        <>
          <BulkDeleteContactsDialog
            ids={selectedIds}
            open={bulkAction === 'delete'}
            onOpenChange={v => !v && setBulkAction(null)}
            onDone={clearSelection}
          />

          <BulkEditContactsDialog
            ids={selectedIds}
            open={bulkAction === 'edit-fields'}
            onOpenChange={v => !v && setBulkAction(null)}
            onDone={clearSelection}
          />

          <BulkChangeTypeDialog
            ids={selectedIds}
            open={bulkAction === 'change-type'}
            onOpenChange={v => !v && setBulkAction(null)}
            onDone={clearSelection}
          />

          <BulkChangeRegionDialog
            ids={selectedIds}
            open={bulkAction === 'change-region'}
            onOpenChange={v => !v && setBulkAction(null)}
            onDone={clearSelection}
          />
        </>
      )}
    </>
  );
}

function ContactsListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Wczytywanie kontaktów">
      <div className="divide-y rounded-xl border bg-card md:hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <div className="h-9 border-b bg-muted" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex h-11 items-center gap-4 border-b px-4 last:border-b-0">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-7 w-7 rounded-full" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="hidden h-4 w-28 @md:block" />
            <Skeleton className="hidden h-4 w-40 @lg:block" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}

import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ContactWithRelations } from '@/integrations/supabase/types';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { cn } from '@/lib/utils';
import { mailtoHref } from '@/lib/mailto';
import { ContactAvatar, ContactTypePill } from './ContactAtoms';

export type SortKey = 'osoba' | 'typ' | 'telefon' | 'email' | 'lokalizacja';
export interface SortState {
  col: SortKey;
  dir: 'asc' | 'desc';
}

interface ColumnDef {
  key: SortKey;
  label: string;
  className?: string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'osoba', label: 'Osoba' },
  { key: 'typ', label: 'Typ' },
  { key: 'telefon', label: 'Telefon', className: 'hidden @md:table-cell' },
  { key: 'email', label: 'Email', className: 'hidden @lg:table-cell' },
  { key: 'lokalizacja', label: 'Region' },
];

interface Props {
  contacts: ContactWithRelations[];
  sort: SortState | null;
  onSort: (col: SortKey) => void;
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
  onToggleAll: () => void;
  masterState: 'none' | 'some' | 'all';
  showSelection: boolean;
  showActions: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onOpen: (c: ContactWithRelations) => void;
  onEdit: (c: ContactWithRelations) => void;
  onDelete: (c: ContactWithRelations) => void;
}

const CHECKBOX = 'h-4 w-4 cursor-pointer rounded border-input accent-primary';
// Tło i przyklejenie na <thead>, nie na komórkach: osobne tła <th> zostawiały jasne szczeliny na ułamkowych granicach kolumn.
const TH = 'h-9 whitespace-nowrap px-3 text-left text-xs font-medium text-muted-foreground';
const TD = 'h-11 px-3 align-middle';

function SortIcon({ active, dir }: { active: boolean; dir?: 'asc' | 'desc' }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-0 transition-opacity group-hover/th:opacity-50" />;
  return dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
}

export function ContactsTable({
  contacts,
  sort,
  onSort,
  selected,
  onToggleSelected,
  onToggleAll,
  masterState,
  showSelection,
  showActions,
  canEdit,
  canDelete,
  onOpen,
  onEdit,
  onDelete,
}: Props) {
  return (
    // Kolumny drugorzędne znikają, gdy obszar modułu jest wąski (np. przy otwartym PoliAI);
    // poniżej `@sm` tabela przewija się w poziomie zamiast wychodzić poza kartę.
    <div className="hidden rounded-xl border bg-card shadow-sm [overflow:clip] @max-sm:overflow-x-auto md:block">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-muted shadow-[inset_0_-1px_0_hsl(var(--border))]">
          <tr>
            {showSelection && (
              <th className={cn(TH, 'w-10 pl-4 pr-0')}>
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={masterState === 'all'}
                  ref={el => {
                    if (el) el.indeterminate = masterState === 'some';
                  }}
                  onChange={onToggleAll}
                  aria-label="Zaznacz wszystkie"
                />
              </th>
            )}
            {COLUMNS.map(c => (
              <th
                key={c.key}
                className={cn(TH, 'group/th', c.className)}
                aria-sort={
                  sort?.col === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
                }
              >
                <button
                  type="button"
                  onClick={() => onSort(c.key)}
                  className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground"
                >
                  {c.label}
                  <SortIcon active={sort?.col === c.key} dir={sort?.dir} />
                </button>
              </th>
            ))}
            <th className={cn(TH, 'hidden w-12 @xl:table-cell')}>
              <span className="sr-only">Dodał</span>
            </th>
            <th className={cn(TH, 'w-24 pr-4')}>
              <span className="sr-only">Akcje</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {contacts.map(c => {
            const isSelected = selected.has(c.id);
            return (
              <tr
                key={c.id}
                onClick={e => {
                  // Kliknięcie w wiersz otwiera szczegóły, chyba że trafiło w kontrolkę (link, przycisk, checkbox, menu).
                  const t = e.target;
                  if (t instanceof Element && t.closest('a, button, input, [role="menuitem"]')) return;
                  onOpen(c);
                }}
                className={cn(
                  'group cursor-pointer border-b transition-colors last:border-b-0',
                  isSelected ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/60',
                )}
              >
                {showSelection && (
                  <td className={cn(TD, 'w-10 pl-4 pr-0')}>
                    <input
                      type="checkbox"
                      className={CHECKBOX}
                      checked={isSelected}
                      onChange={() => onToggleSelected(c.id)}
                      aria-label={`Zaznacz ${c.first_name} ${c.last_name}`}
                    />
                  </td>
                )}
                <td className={cn(TD, 'max-w-[280px]')}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ContactAvatar firstName={c.first_name} lastName={c.last_name} type={c.type} />
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpen(c)}
                        className="block max-w-full truncate rounded-sm text-left font-medium hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {c.first_name} {c.last_name}
                      </button>
                      {c.function && (
                        <div className="truncate text-xs text-muted-foreground">{c.function}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className={cn(TD, 'whitespace-nowrap')}>
                  <ContactTypePill type={c.type} />
                </td>
                <td className={cn(TD, 'hidden whitespace-nowrap text-[13px] @md:table-cell')}>
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="hover:text-primary hover:underline">
                      {c.phone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
                <td className={cn(TD, 'hidden whitespace-nowrap text-[13px] @lg:table-cell')}>
                  {c.email ? (
                    <EmailCell email={c.email} />
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
                <td className={cn(TD, 'max-w-[220px] text-[13px]')}>
                  <div className="truncate">
                    {c.powiat?.name ?? <span className="text-muted-foreground">–</span>}
                    {c.gmina && <span className="text-muted-foreground"> · {c.gmina.name}</span>}
                  </div>
                  {c.miejscowosc && (
                    <div className="truncate text-xs text-muted-foreground">{c.miejscowosc}</div>
                  )}
                </td>
                <td className={cn(TD, 'hidden w-12 @xl:table-cell')}>
                  {c.creator && (
                    <CreatorAvatar name={c.creator.full_name} avatarUrl={c.creator.avatar_url} />
                  )}
                </td>
                <td className={cn(TD, 'w-24 pr-4')}>
                  <RowActions
                    contact={c}
                    showActions={showActions}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface RowActionsProps {
  contact: ContactWithRelations;
  showActions: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (c: ContactWithRelations) => void;
  onDelete: (c: ContactWithRelations) => void;
}

/** Adres e-mail w tabeli: link `mailto:` tylko dla prostego adresu, inaczej sam tekst. */
function EmailCell({ email }: { email: string }) {
  const href = mailtoHref(email);
  const className = 'block max-w-[220px] truncate';
  return href ? (
    <a href={href} className={cn(className, 'hover:text-primary hover:underline')}>
      {email}
    </a>
  ) : (
    <span className={className} title={email}>
      {email}
    </span>
  );
}

/** Szybkie akcje wiersza: widoczne po najechaniu (mysz), zawsze na ekranach dotykowych i przy fokusie. */
function RowActions({ contact: c, showActions, canEdit, canDelete, onEdit, onDelete }: RowActionsProps) {
  const name = `${c.first_name} ${c.last_name}`;
  const emailHref = mailtoHref(c.email);
  return (
    <div className="flex items-center justify-end gap-0.5 transition-opacity focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:hover)]:opacity-0">
      {c.phone && (
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" asChild>
          <a href={`tel:${c.phone}`} aria-label={`Zadzwoń: ${name}`} title="Zadzwoń">
            <Phone className="h-4 w-4" />
          </a>
        </Button>
      )}
      {emailHref && (
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" asChild>
          <a href={emailHref} aria-label={`Napisz: ${name}`} title="Napisz e-mail">
            <Mail className="h-4 w-4" />
          </a>
        </Button>
      )}
      {showActions && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              aria-label="Opcje"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {canEdit && (
              <DropdownMenuItem onClick={() => onEdit(c)}>
                <Pencil className="h-4 w-4" />
                Edytuj
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(c)}
              >
                <Trash2 className="h-4 w-4" />
                Usuń
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

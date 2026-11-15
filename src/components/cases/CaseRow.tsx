import { Eye, Globe, MoreHorizontal, Trash2 } from 'lucide-react';
import { format, isPast, isThisYear } from 'date-fns';
import { pl } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { isCaseResolved } from '@/lib/cases';
import type { CaseWithRelations } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import { CasePriorityFlag, CaseStatusPill } from './CaseBadges';

/**
 * Kolumny widoku listy wg szerokości obszaru modułu (container queries, nie viewport - PoliAI zwęża moduł):
 * - @md: tytuł, status, osoba, termin, akcje (kategoria i priorytet ukryte, żeby tytuł miał miejsce),
 * - @lg: tytuł, status, kategoria, priorytet, osoba, termin, akcje.
 */
export const CASE_ROW_GRID =
  '@md:grid @md:grid-cols-[minmax(0,1fr)_7.5rem_3.5rem_6.5rem_6.5rem] @md:items-center @md:gap-3 @lg:grid-cols-[minmax(0,1fr)_7.5rem_9rem_6rem_3.5rem_6.5rem_6.5rem]';

interface Props {
  case_: CaseWithRelations;
  canDelete: boolean;
  onPreview: (c: CaseWithRelations) => void;
  onDelete: (c: CaseWithRelations) => void;
}

function formatDue(value: string) {
  const date = new Date(value);
  return format(date, isThisYear(date) ? 'd MMM' : 'd MMM yyyy', { locale: pl });
}

export function CaseRow({ case_: c, canDelete, onPreview, onDelete }: Props) {
  const overdue = Boolean(c.due_date) && !isCaseResolved(c.status) && isPast(new Date(c.due_date ?? ''));
  const reporter = c.contact
    ? `${c.contact.first_name} ${c.contact.last_name}`.trim()
    : c.reporter_name;
  const secondary = [reporter, c.powiat?.name].filter(Boolean).join(' · ');

  return (
    <li
      className={cn(
        'group relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 px-3 py-3 transition-colors hover:bg-muted/60',
        '@md:h-11 @md:py-0',
        CASE_ROW_GRID,
      )}
    >
      {/* Tytuł: przycisk rozciągnięty na cały wiersz (klik w wiersz = podgląd). */}
      <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onPreview(c)}
          className={cn(
            'min-w-0 text-left text-sm font-medium outline-none',
            'after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring',
          )}
        >
          <span className="line-clamp-2 @md:line-clamp-1">{c.title}</span>
        </button>
        {c.source === 'public_form' && (
          <span className="shrink-0 text-muted-foreground" title="Zgłoszenie z formularza publicznego">
            <Globe className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Publiczne</span>
          </span>
        )}
        {secondary && (
          <span className="hidden min-w-0 truncate text-xs text-muted-foreground @lg:inline">
            {secondary}
          </span>
        )}
      </div>

      {/* Meta: w wąskim module jeden zawijany wiersz, w szerszym osobne kolumny siatki. */}
      <div className="col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 @md:contents">
        <div className="flex">
          <CaseStatusPill status={c.status} />
        </div>
        <div className="flex min-w-0 @md:hidden @lg:flex">
          {c.category ? (
            <span className="inline-block max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {c.category.name}
            </span>
          ) : (
            <span className="hidden text-xs text-muted-foreground/60 @md:inline">—</span>
          )}
        </div>
        <div className={cn('flex @md:hidden @lg:flex', c.priority === 'normal' && '@max-md:hidden')}>
          <CasePriorityFlag priority={c.priority} showLabel className="text-muted-foreground" />
        </div>
        <div className="flex items-center">
          {c.assigned ? (
            <CreatorAvatar name={c.assigned.full_name} avatarUrl={c.assigned.avatar_url} />
          ) : (
            <span
              className="hidden h-6 w-6 rounded-full border border-dashed border-muted-foreground/40 @md:inline-block"
              title="Nieprzypisana"
            />
          )}
        </div>
        <div className="text-xs">
          {c.due_date ? (
            <span
              className={cn(
                'whitespace-nowrap',
                overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
              )}
              title={overdue ? 'Termin minął' : 'Termin'}
            >
              {formatDue(c.due_date)}
              {overdue && <span className="sr-only"> (zaległa)</span>}
            </span>
          ) : (
            <span className="hidden text-muted-foreground/60 @md:inline">—</span>
          )}
        </div>
      </div>

      {/* Akcje: wąski moduł - menu zawsze widoczne (na desktopie w gęstości desktopowej). */}
      <div className="relative z-10 col-start-2 row-span-2 row-start-1 @md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-11 w-11 md:h-8 md:w-8" aria-label="Opcje">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => onPreview(c)}>
              <Eye className="mr-2 h-4 w-4" />
              Podgląd
            </DropdownMenuItem>
            {canDelete && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(c)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Usuń
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Akcje: szeroki moduł - odsłaniane po najechaniu (urządzenia z hover), zawsze widoczne dla dotyku. */}
      <div
        className={cn(
          'relative z-10 hidden items-center justify-end gap-0.5 @md:flex',
          'transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100',
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Podgląd"
          title="Podgląd"
          onClick={() => onPreview(c)}
        >
          <Eye className="h-4 w-4" />
        </Button>
        {canDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label="Usuń"
            title="Usuń"
            onClick={() => onDelete(c)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </li>
  );
}

import { FileText, Image as ImageIcon, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PAYMENT_METHOD_LABELS, formatPLN, isReceiptPdf } from '@/lib/expenses';
import type { OfficeExpenseWithRelations } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import { ExpenseCategoryPill } from './ExpenseCategoryPill';

interface Props {
  expense: OfficeExpenseWithRelations;
  writer: boolean;
  admin: boolean;
  onOpen: (e: OfficeExpenseWithRelations) => void;
  onEdit: (e: OfficeExpenseWithRelations) => void;
  onDelete: (e: OfficeExpenseWithRelations) => void;
  onPreviewReceipt: (e: OfficeExpenseWithRelations) => void;
}

/** Szerokości kolumn współdzielone z nagłówkiem listy (ExpensesList). Kolumny zależą od szerokości modułu (@container). */
export const EXPENSE_COLUMNS = {
  date: 'hidden w-16 shrink-0 @md:block',
  vendor: 'hidden w-40 shrink-0 @lg:block @xl:w-48',
  category: 'hidden w-44 shrink-0 @md:block @xl:w-60',
  payment: 'hidden w-20 shrink-0 @xl:block',
  receipt: 'w-11 shrink-0 md:w-8',
  amount: 'w-24 shrink-0 text-right @sm:w-28 @max-md:w-auto',
  actions: 'w-11 shrink-0 md:w-[4.25rem]',
} as const;

// Telefon: rozmiar z Button size="icon" (44 px); md+ zwarte 32 px.
const ICON_BUTTON = 'relative z-10 text-muted-foreground hover:text-foreground md:h-8 md:w-8';

export function ExpenseRow({ expense: e, writer, admin, onOpen, onEdit, onDelete, onPreviewReceipt }: Props) {
  const ReceiptIcon = isReceiptPdf(e.receipt_mime) ? FileText : ImageIcon;
  const date = new Date(e.expense_date);
  const hasActions = writer || admin;

  return (
    <li className="group relative flex min-h-12 items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/60 md:min-h-11 md:gap-3 md:py-1">
      <span
        className={cn(EXPENSE_COLUMNS.date, 'text-xs tabular-nums text-muted-foreground')}
        title={format(date, 'd MMMM yyyy', { locale: pl })}
      >
        {format(date, 'd MMM', { locale: pl })}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <button
            type="button"
            onClick={() => onOpen(e)}
            className="min-w-0 max-w-full truncate text-left text-sm font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring/60"
            title={e.title}
          >
            {e.title}
          </button>
          {e.description && (
            <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground @xl:block">
              {e.description}
            </span>
          )}
        </div>
        {/* Wąski moduł: data i kontrahent w jednej linii (kontrahent się skraca), kategoria przechodzi do kolejnej
            linii, zamiast ścinać obie do kilku liter. */}
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground @md:hidden">
          <span className="flex min-w-0 max-w-full items-center gap-1.5">
            <span className="shrink-0 tabular-nums">{format(date, 'd MMM', { locale: pl })}</span>
            {e.vendor && <span className="min-w-0 truncate">· {e.vendor}</span>}
            {e.receipt_path && <ReceiptIcon className="h-3.5 w-3.5 shrink-0" aria-label="Ma załącznik" />}
          </span>
          {e.category && <ExpenseCategoryPill category={e.category} className="min-w-0" />}
        </div>
      </div>

      <span
        className={cn(EXPENSE_COLUMNS.vendor, 'truncate text-xs text-muted-foreground')}
        title={e.invoice_number ? `${e.vendor ?? ''} · Nr: ${e.invoice_number}` : (e.vendor ?? undefined)}
      >
        {e.vendor ?? '—'}
      </span>

      <span className={EXPENSE_COLUMNS.category}>
        <ExpenseCategoryPill category={e.category} />
      </span>

      <span className={cn(EXPENSE_COLUMNS.payment, 'truncate text-xs text-muted-foreground')}>
        {e.payment_method ? PAYMENT_METHOD_LABELS[e.payment_method] : '—'}
      </span>

      {/* Telefon: przy menu "Opcje" podgląd załącznika jest w menu (i w formularzu/podglądzie wydatku). */}
      <span
        className={cn(EXPENSE_COLUMNS.receipt, e.receipt_path && !hasActions ? 'flex' : 'hidden md:flex', 'justify-center')}
      >
        {e.receipt_path && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={ICON_BUTTON}
            onClick={() => onPreviewReceipt(e)}
            aria-label="Podgląd załącznika"
            title="Podgląd załącznika"
          >
            <ReceiptIcon />
          </Button>
        )}
      </span>

      <span className={cn(EXPENSE_COLUMNS.amount, 'text-sm font-semibold tabular-nums')}>{formatPLN(e.amount)}</span>

      {hasActions && (
        <div className={cn(EXPENSE_COLUMNS.actions, 'flex justify-end')}>
          {/* Desktop: akcje inline, odsłaniane po najechaniu (na urządzeniach bez hovera zawsze widoczne). */}
          <div className="hidden items-center gap-0.5 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 md:flex [@media(hover:hover)]:opacity-0">
            {writer && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={ICON_BUTTON}
                onClick={() => onEdit(e)}
                aria-label="Edytuj"
                title="Edytuj"
              >
                <Pencil />
              </Button>
            )}
            {admin && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(ICON_BUTTON, 'hover:text-destructive')}
                onClick={() => onDelete(e)}
                aria-label="Usuń"
                title="Usuń"
              >
                <Trash2 />
              </Button>
            )}
          </div>

          {/* Mobile: jedno menu "Opcje" (cel dotykowy 44px). */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className={cn(ICON_BUTTON, 'md:hidden')} aria-label="Opcje">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {e.receipt_path && (
                <DropdownMenuItem onClick={() => onPreviewReceipt(e)}>Podgląd załącznika</DropdownMenuItem>
              )}
              {writer && <DropdownMenuItem onClick={() => onEdit(e)}>Edytuj</DropdownMenuItem>}
              {admin && (
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(e)}>
                  Usuń
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  );
}

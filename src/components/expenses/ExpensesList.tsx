import { useState } from 'react';
import { Plus, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { canWrite, isAdmin } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import type { OfficeExpenseWithRelations } from '@/integrations/supabase/types';
import { EXPENSE_COLUMNS, ExpenseRow } from './ExpenseRow';
import { ReceiptViewer } from './ReceiptViewer';

interface Props {
  expenses: OfficeExpenseWithRelations[];
  isLoading: boolean;
  /** Klik w wiersz: edycja (writer) lub podgląd (odczyt). */
  onOpen: (e: OfficeExpenseWithRelations) => void;
  onEdit: (e: OfficeExpenseWithRelations) => void;
  onDelete: (e: OfficeExpenseWithRelations) => void;
  /** Akcja w pustym stanie (np. "Dodaj wydatek"); brak = tylko komunikat. */
  onAdd?: () => void;
}

export function ExpensesList({ expenses, isLoading, onOpen, onEdit, onDelete, onAdd }: Props) {
  const { profile } = useAuth();
  const writer = canWrite(profile?.role);
  const admin = isAdmin(profile?.role);
  const [previewing, setPreviewing] = useState<OfficeExpenseWithRelations | null>(null);

  if (isLoading) {
    return (
      <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-card">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex h-12 items-center gap-3 px-3">
            <Skeleton className="hidden h-3 w-12 @md:block" />
            <Skeleton className="h-3.5 flex-1 max-w-[16rem]" />
            <Skeleton className="ml-auto hidden h-5 w-28 rounded-full @md:block" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (expenses.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Receipt className="h-5 w-5" />
        </span>
        <p className="text-sm text-muted-foreground">Brak wydatków dla wybranych filtrów.</p>
        {onAdd && (
          <Button size="sm" onClick={onAdd}>
            <Plus />
            Dodaj wydatek
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div
          className="hidden h-9 items-center gap-3 border-b bg-muted/40 px-3 text-xs font-medium text-muted-foreground @md:flex"
          aria-hidden
        >
          <span className={EXPENSE_COLUMNS.date}>Data</span>
          <span className="min-w-0 flex-1">Tytuł</span>
          <span className={EXPENSE_COLUMNS.vendor}>Kontrahent</span>
          <span className={EXPENSE_COLUMNS.category}>Kategoria</span>
          <span className={EXPENSE_COLUMNS.payment}>Płatność</span>
          <span className={cn(EXPENSE_COLUMNS.receipt, 'hidden md:block')} />
          <span className={EXPENSE_COLUMNS.amount}>Kwota</span>
          {(writer || admin) && <span className={EXPENSE_COLUMNS.actions} />}
        </div>
        <ul className="divide-y">
          {expenses.map((e) => (
            <ExpenseRow
              key={e.id}
              expense={e}
              writer={writer}
              admin={admin}
              onOpen={onOpen}
              onEdit={onEdit}
              onDelete={onDelete}
              onPreviewReceipt={setPreviewing}
            />
          ))}
        </ul>
      </div>

      {previewing && (
        <ReceiptViewer
          path={previewing.receipt_path}
          mime={previewing.receipt_mime}
          title={previewing.title}
          onClose={() => setPreviewing(null)}
        />
      )}
    </>
  );
}

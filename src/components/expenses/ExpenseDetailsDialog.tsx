import { useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PAYMENT_METHOD_LABELS, formatPLN, isReceiptPdf } from '@/lib/expenses';
import type { OfficeExpenseWithRelations } from '@/integrations/supabase/types';
import { ExpenseCategoryPill } from './ExpenseCategoryPill';
import { ReceiptViewer } from './ReceiptViewer';

interface Props {
  expense: OfficeExpenseWithRelations | null;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm max-md:whitespace-normal max-md:break-words">{children}</dd>
    </div>
  );
}

/** Podgląd wydatku tylko do odczytu (role bez prawa zapisu, deep-link `?open=<id>`). */
export function ExpenseDetailsDialog({ expense, onClose }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const ReceiptIcon = isReceiptPdf(expense?.receipt_mime) ? FileText : ImageIcon;

  return (
    <>
      <Dialog open={Boolean(expense)} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92vh] overflow-y-auto rounded-xl sm:max-w-lg">
          {expense && (
            <>
              <DialogHeader className="space-y-2 pr-6 text-left">
                <ExpenseCategoryPill category={expense.category} className="self-start" />
                <DialogTitle className="text-lg leading-snug">{expense.title}</DialogTitle>
                <DialogDescription className="text-2xl font-semibold tabular-nums text-foreground">
                  {formatPLN(expense.amount)}
                </DialogDescription>
              </DialogHeader>

              <dl className="grid grid-cols-1 gap-x-4 gap-y-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-2">
                <Field label="Data wydatku">
                  {format(new Date(expense.expense_date), 'd MMMM yyyy', { locale: pl })}
                </Field>
                <Field label="Metoda płatności">
                  {expense.payment_method ? PAYMENT_METHOD_LABELS[expense.payment_method] : '—'}
                </Field>
                <Field label="Kontrahent">{expense.vendor ?? '—'}</Field>
                <Field label="Nr faktury / rachunku">{expense.invoice_number ?? '—'}</Field>
                <Field label="Dodał">{expense.creator?.full_name ?? '—'}</Field>
              </dl>

              {expense.description && (
                <section className="space-y-1">
                  <h3 className="text-xs font-medium text-muted-foreground">Opis</h3>
                  <p className="whitespace-pre-wrap text-sm">{expense.description}</p>
                </section>
              )}
              {expense.notes && (
                <section className="space-y-1">
                  <h3 className="text-xs font-medium text-muted-foreground">Notatki wewnętrzne</h3>
                  <p className="whitespace-pre-wrap text-sm">{expense.notes}</p>
                </section>
              )}

              {expense.receipt_path ? (
                <Button variant="outline" className="w-full sm:w-auto sm:justify-self-start" onClick={() => setPreviewOpen(true)}>
                  <ReceiptIcon />
                  Podgląd załącznika
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">Brak załącznika.</p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {previewOpen && expense && (
        <ReceiptViewer
          path={expense.receipt_path}
          mime={expense.receipt_mime}
          title={expense.title}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}

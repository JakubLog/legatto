import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodFormResolver } from '@/lib/zodForm';
import { z } from 'zod';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchSelect } from '@/components/ui/search-select';
import { Separator } from '@/components/ui/separator';

import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, expenseCategoryClasses } from '@/lib/expenses';
import { cn } from '@/lib/utils';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import { useDeleteReceipt } from '@/hooks/useReceipts';
import {
  useCreateExpense,
  useUpdateExpense,
  type ExpenseInput,
} from '@/hooks/useExpenses';
import type {
  OfficeExpenseWithRelations,
  PaymentMethod,
} from '@/integrations/supabase/types';
import { errorMessage } from '@/lib/errors';
import { AddExpenseCategoryDialog } from './AddExpenseCategoryDialog';
import { ReceiptUploadButton } from './ReceiptUploadButton';

const NONE = '__none__';

const schema = z.object({
  title: z.string().min(2, 'Min. 2 znaki').max(200, 'Max. 200 znaków'),
  description: z.string().optional(),
  amount: z.coerce.number().positive('Kwota musi być dodatnia'),
  category_id: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
  expense_date: z.string().min(1, 'Wymagane'),
  vendor: z.string().optional(),
  invoice_number: z.string().optional(),
  payment_method: z.enum(['przelew', 'karta', 'gotowka', 'inne']).optional().or(z.literal('').transform(() => undefined)),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: OfficeExpenseWithRelations | null;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const DEFAULTS: FormValues = {
  title: '',
  description: '',
  amount: 0,
  category_id: undefined,
  expense_date: todayIso(),
  vendor: '',
  invoice_number: '',
  payment_method: undefined,
  notes: '',
};

export function ExpenseFormDialog({ open, onOpenChange, expense }: Props) {
  const { data: categories } = useExpenseCategories();
  const createMut = useCreateExpense();
  const updateMut = useUpdateExpense();
  const deleteReceiptMut = useDeleteReceipt();

  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  const [receiptMime, setReceiptMime] = useState<string | null>(null);
  const [originalReceiptPath, setOriginalReceiptPath] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodFormResolver(schema),
    defaultValues: DEFAULTS,
  });

  useEffect(() => {
    if (!open) return;
    if (expense) {
      form.reset({
        title: expense.title,
        description: expense.description ?? '',
        amount: Number(expense.amount),
        category_id: expense.category_id ?? undefined,
        expense_date: expense.expense_date,
        vendor: expense.vendor ?? '',
        invoice_number: expense.invoice_number ?? '',
        payment_method: expense.payment_method ?? undefined,
        notes: expense.notes ?? '',
      });
      setReceiptPath(expense.receipt_path);
      setReceiptMime(expense.receipt_mime);
      setOriginalReceiptPath(expense.receipt_path);
    } else {
      form.reset({ ...DEFAULTS, expense_date: todayIso() });
      setReceiptPath(null);
      setReceiptMime(null);
      setOriginalReceiptPath(null);
    }
  }, [open, expense, form]);

  const isEdit = Boolean(expense);
  const submitting = createMut.isPending || updateMut.isPending;

  const onSubmit = async (values: FormValues) => {
    const payload: ExpenseInput = {
      title: values.title.trim(),
      description: values.description?.trim() || null,
      amount: values.amount,
      category_id: values.category_id ?? null,
      expense_date: values.expense_date,
      vendor: values.vendor?.trim() || null,
      invoice_number: values.invoice_number?.trim() || null,
      payment_method: values.payment_method ?? null,
      receipt_path: receiptPath,
      receipt_mime: receiptMime,
      notes: values.notes?.trim() || null,
    };

    try {
      if (isEdit && expense) {
        // Plik wysylamy tylko, gdy uzytkownik go zmienil - i warunkowo wzgledem pliku z chwili
        // otwarcia, zeby nie nadpisac pliku podpietego w miedzyczasie (MCP).
        const { receipt_path, receipt_mime, ...fields } = payload;
        await updateMut.mutateAsync(
          receiptPath !== originalReceiptPath
            ? { id: expense.id, ...fields, receipt_path, receipt_mime, expectedReceiptPath: originalReceiptPath }
            : { id: expense.id, ...fields },
        );
        toast.success('Wydatek zaktualizowany');
      } else {
        await createMut.mutateAsync(payload);
        toast.success('Wydatek dodany');
      }
      // Sprzatamy stary plik gdy podmieniono na nowy.
      if (originalReceiptPath && originalReceiptPath !== receiptPath) {
        await deleteReceiptMut.mutateAsync(originalReceiptPath).catch(() => {
          // best-effort
        });
      }
      onOpenChange(false);
    } catch (err) {
      toast.error('Błąd zapisu', { description: errorMessage(err) });
    }
  };

  const handleClearReceipt = async () => {
    // Plik dopiero co wgrany w trakcie tej sesji (nie powiazany jeszcze z rekordem) - usuwamy.
    if (receiptPath && receiptPath !== originalReceiptPath) {
      await deleteReceiptMut.mutateAsync(receiptPath).catch(() => undefined);
    }
    setReceiptPath(null);
    setReceiptMime(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto rounded-xl sm:max-w-2xl">
          <DialogHeader className="text-left">
            <DialogTitle>{isEdit ? 'Edytuj wydatek' : 'Nowy wydatek'}</DialogTitle>
            <DialogDescription>
              {expense?.creator?.full_name && <>Dodał: {expense.creator.full_name}. </>}
              Wymagane: tytuł, kwota, data. Załącznik (faktura/paragon) opcjonalny.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="title">Tytuł *</Label>
                <Input id="title" placeholder="np. Czynsz biuro Kraków - kwiecień" {...form.register('title')} />
                {form.formState.errors.title && (
                  <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="amount">Kwota PLN *</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    inputMode="decimal"
                    {...form.register('amount')}
                  />
                  {form.formState.errors.amount && (
                    <p className="text-xs text-destructive">{form.formState.errors.amount.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense_date">Data wydatku *</Label>
                  <Input id="expense_date" type="date" {...form.register('expense_date')} />
                  {form.formState.errors.expense_date && (
                    <p className="text-xs text-destructive">{form.formState.errors.expense_date.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payment_method">Metoda płatności</Label>
                  <Select
                    value={form.watch('payment_method') ?? NONE}
                    onValueChange={(v) =>
                      form.setValue('payment_method', v === NONE ? undefined : (v as PaymentMethod), {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger id="payment_method">
                      <SelectValue placeholder="Wybierz" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>- brak -</SelectItem>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {PAYMENT_METHOD_LABELS[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="category_id">Kategoria</Label>
                <div className="flex gap-2">
                  <SearchSelect
                    id="category_id"
                    className="flex-1"
                    value={form.watch('category_id') ? String(form.watch('category_id')) : null}
                    onChange={(v) =>
                      form.setValue('category_id', v ? Number(v) : undefined, {
                        shouldValidate: true,
                      })
                    }
                    noneLabel="- brak -"
                    options={(categories ?? []).map((c) => ({
                      value: String(c.id),
                      label: c.name,
                      icon: (
                        <span
                          className={cn('h-2 w-2 shrink-0 rounded-full', expenseCategoryClasses(c.color).dot)}
                          aria-hidden
                        />
                      ),
                    }))}
                  />
                  {/* Zarządzanie kategoriami (konfiguracja) tylko na komputerze. */}
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="max-md:hidden"
                    onClick={() => setAddCategoryOpen(true)}
                    aria-label="Dodaj kategorię"
                  >
                    <Plus />
                  </Button>
                </div>
              </div>
            </div>

            <Separator />

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="vendor">Kontrahent</Label>
                <Input id="vendor" placeholder="np. ENEA SA" {...form.register('vendor')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice_number">Nr faktury / rachunku</Label>
                <Input id="invoice_number" placeholder="np. FV/2026/04/123" {...form.register('invoice_number')} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Opis</Label>
              <Textarea id="description" rows={3} {...form.register('description')} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notatki wewnętrzne</Label>
              <Textarea id="notes" rows={2} {...form.register('notes')} />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Faktura / paragon (skan)</Label>
              <ReceiptUploadButton
                receiptPath={receiptPath}
                receiptMime={receiptMime}
                onUploaded={(path, mime) => {
                  // Jesli byl jakis tymczasowy plik z tej sesji - skasuj.
                  if (receiptPath && receiptPath !== originalReceiptPath) {
                    void deleteReceiptMut.mutateAsync(receiptPath).catch(() => undefined);
                  }
                  setReceiptPath(path);
                  setReceiptMime(mime);
                }}
                onCleared={handleClearReceipt}
              />
            </div>

            <DialogFooter className="gap-2 border-t pt-4 sm:space-x-0 max-md:!flex-col-reverse max-md:!gap-3 max-md:[&>button]:w-full">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Anuluj
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isEdit ? 'Zapisz' : 'Dodaj'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AddExpenseCategoryDialog
        open={addCategoryOpen}
        onOpenChange={setAddCategoryOpen}
        onCreated={(created) => form.setValue('category_id', created.id, { shouldValidate: true })}
      />
    </>
  );
}

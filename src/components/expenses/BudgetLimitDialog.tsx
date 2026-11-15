import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUpdateBudgetSettings } from '@/hooks/useBudgetSettings';
import { errorMessage } from '@/lib/errors';
import { MAX_MONTHLY_LIMIT_PLN, budgetSettingsSchema, formatPLN } from '@/lib/expenses';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Aktualny limit (wartość startowa pola). */
  currentLimit: number;
}

/** Edycja miesięcznego limitu koszyka (Poseł/Administrator). */
export function BudgetLimitDialog({ open, onOpenChange, currentLimit }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const updateMut = useUpdateBudgetSettings();

  useEffect(() => {
    if (open) {
      setValue(String(currentLimit));
      setError(null);
    }
  }, [open, currentLimit]);

  const submit = async () => {
    // Pole tekstowe: dopuszczamy spacje tysięcy ("25 000"), tylko cyfry - "25.000" to po polsku 25 tysięcy,
    // a Number() dałby 25 zł; "1e4" też odrzucamy.
    const raw = value.replace(/\s/g, '');
    if (!/^\d+$/.test(raw)) {
      setError('Podaj kwotę w pełnych złotych, same cyfry (bez kropek i przecinków).');
      return;
    }
    const parsed = budgetSettingsSchema.safeParse({ monthly_limit_pln: Number(raw) });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Nieprawidłowy limit');
      return;
    }
    try {
      await updateMut.mutateAsync(parsed.data);
      toast.success(`Limit miesięczny: ${formatPLN(parsed.data.monthly_limit_pln)}`);
      onOpenChange(false);
    } catch (err) {
      toast.error('Nie udało się zapisać limitu', { description: errorMessage(err) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle>Miesięczny limit budżetu</DialogTitle>
          <DialogDescription>
            Kwota koszyka na każdy miesiąc kalendarzowy (np. ryczałt na biuro). Zmiana obowiązuje od razu we wszystkich
            widokach budżetu, także dla miesięcy archiwalnych.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor="budget-monthly-limit">Limit (zł)</Label>
          <Input
            id="budget-monthly-limit"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            aria-invalid={error !== null}
            aria-describedby="budget-monthly-limit-hint"
          />
          <p
            id="budget-monthly-limit-hint"
            className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
          >
            {error ?? `Pełne złote, od 1 do ${formatPLN(MAX_MONTHLY_LIMIT_PLN)}.`}
          </p>
        </form>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button disabled={updateMut.isPending || value.trim() === ''} onClick={() => void submit()}>
            {updateMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

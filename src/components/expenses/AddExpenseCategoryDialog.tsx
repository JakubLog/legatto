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
import { useCreateExpenseCategory } from '@/hooks/useExpenseCategories';
import type { ExpenseCategory } from '@/integrations/supabase/types';
import { errorMessage } from '@/lib/errors';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (category: ExpenseCategory) => void;
}

export function AddExpenseCategoryDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('');
  const createMut = useCreateExpenseCategory();

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  const submit = async () => {
    try {
      const created = await createMut.mutateAsync(name);
      toast.success(`Dodano kategorię "${created.name}"`);
      onCreated(created);
      onOpenChange(false);
    } catch (err) {
      toast.error('Błąd dodawania kategorii', { description: errorMessage(err) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle>Nowa kategoria wydatku</DialogTitle>
          <DialogDescription>
            Dodaj własną kategorię. Będzie dostępna dla wszystkich użytkowników.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="expense-category-name">Nazwa</Label>
          <Input
            id="expense-category-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="np. Sprzątanie biura"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim().length >= 2) {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Anuluj</Button>
          <Button disabled={createMut.isPending || name.trim().length < 2} onClick={submit}>
            {createMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Dodaj
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

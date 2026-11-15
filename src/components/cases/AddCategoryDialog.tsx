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
import { useCreateCaseCategory } from '@/hooks/useCaseCategories';
import type { CaseCategory } from '@/integrations/supabase/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (category: CaseCategory) => void;
}

export function AddCategoryDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('');
  const createMut = useCreateCaseCategory();

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
      toast.error('Błąd dodawania kategorii', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nowa kategoria</DialogTitle>
          <DialogDescription>
            Dodaj własną kategorię spraw. Będzie dostępna dla wszystkich użytkowników.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="category-name">Nazwa</Label>
          <Input
            id="category-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="np. Transport publiczny"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim().length >= 2) {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        <DialogFooter>
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

import { useState } from 'react';
import { Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CONTACT_TYPE_LABELS, CONTACT_TYPES } from '@/lib/contacts';
import { useBulkUpdateContacts } from '@/hooks/useContacts';
import type { ContactType } from '@/integrations/supabase/types';

interface Props {
  ids: string[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}

export function BulkChangeTypeDialog({ ids, open, onOpenChange, onDone }: Props) {
  const [type, setType] = useState<ContactType | ''>('');
  const { mutateAsync, isPending } = useBulkUpdateContacts();

  const handleConfirm = async () => {
    if (!type) return;
    try {
      const n = await mutateAsync({ ids, patch: { type } });
      toast.success(`Zaktualizowano ${n} ${n === 1 ? 'kontakt' : 'kontaktów'}`);
      onDone();
      setType('');
      onOpenChange(false);
    } catch {
      toast.error('Nie udało się zmienić typu');
    }
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) setType('');
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Tag className="h-4 w-4" />
            </span>
            Zmień typ dla {ids.length} kontaktów
          </DialogTitle>
          <DialogDescription>
            Wybrany typ zostanie ustawiony dla wszystkich zaznaczonych rekordów.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Nowy typ kontaktu</Label>
          <Select value={type} onValueChange={v => setType(v as ContactType)}>
            <SelectTrigger>
              <SelectValue placeholder="Wybierz typ" />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_TYPES.map(t => (
                <SelectItem key={t} value={t}>
                  {CONTACT_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Anuluj
          </Button>
          <Button onClick={handleConfirm} disabled={isPending || !type}>
            {isPending ? 'Zapisywanie…' : 'Zastosuj'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

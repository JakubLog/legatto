import { useEffect, useState, type FormEvent } from 'react';
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
import { useUpdateAppSetting } from '@/hooks/useAppSetting';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentDays: number;
}

export function VisibilitySettingsDialog({ open, onOpenChange, currentDays }: Props) {
  const [days, setDays] = useState<string>(String(currentDays));
  const updateMut = useUpdateAppSetting();

  useEffect(() => {
    if (open) setDays(String(currentDays));
  }, [open, currentDays]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(days);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      toast.error('Wartość poza zakresem (1-365)');
      return;
    }
    try {
      await updateMut.mutateAsync({ key: 'visibility_alert_days', value: n });
      toast.success(`Ustawiono próg na ${n} dni`);
      onOpenChange(false);
    } catch (err) {
      toast.error('Błąd zapisu', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ustawienia widoczności</DialogTitle>
          <DialogDescription>
            Powiaty bez wydarzeń typu spotkanie lub wyjazd przez ten okres będą oznaczone jako „Brak obecności”
            (czerwony).
          </DialogDescription>
        </DialogHeader>
        <form id="visibility-settings-form" onSubmit={handleSave} className="space-y-2">
          <Label htmlFor="threshold">Próg alertu</Label>
          <div className="flex items-center gap-2">
            <Input
              id="threshold"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-28 tabular-nums"
            />
            <span className="text-sm text-muted-foreground">dni</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Po połowie progu – ostrzeżenie (żółty), po jego przekroczeniu – alert (czerwony).
          </p>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button type="submit" form="visibility-settings-form" disabled={updateMut.isPending}>
            {updateMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from 'react';
import { MapPin } from 'lucide-react';
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
import { SearchSelect } from '@/components/ui/search-select';
import { useBulkUpdateContacts } from '@/hooks/useContacts';
import { useGminy } from '@/hooks/useGminy';
import { usePowiaty } from '@/hooks/usePowiaty';

interface Props {
  ids: string[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}

export function BulkChangeRegionDialog({ ids, open, onOpenChange, onDone }: Props) {
  const { data: powiaty = [] } = usePowiaty();
  const [powiatId, setPowiatId] = useState<number | null>(null);
  const { data: gminy = [] } = useGminy(powiatId);
  const [gminaId, setGminaId] = useState<number | null>(null);
  const { mutateAsync, isPending } = useBulkUpdateContacts();

  const reset = () => {
    setPowiatId(null);
    setGminaId(null);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleConfirm = async () => {
    if (!powiatId) return;
    try {
      const n = await mutateAsync({
        ids,
        patch: { powiat_id: powiatId, gmina_id: gminaId },
      });
      toast.success(`Zaktualizowano ${n} ${n === 1 ? 'kontakt' : 'kontaktów'}`);
      onDone();
      reset();
      onOpenChange(false);
    } catch {
      toast.error('Nie udało się zmienić regionu');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MapPin className="h-4 w-4" />
            </span>
            Zmień region dla {ids.length} kontaktów
          </DialogTitle>
          <DialogDescription>
            Powiat zostanie ustawiony dla wszystkich. Gmina jest opcjonalna — jeśli jej nie
            wybierzesz, zostanie wyzerowana.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-region-powiat">
              Powiat <span className="text-destructive">*</span>
            </Label>
            <SearchSelect
              id="bulk-region-powiat"
              value={powiatId ? String(powiatId) : null}
              onChange={v => {
                setPowiatId(v ? Number(v) : null);
                setGminaId(null);
              }}
              placeholder="Wybierz powiat"
              options={powiaty.map(p => ({ value: String(p.id), label: p.name }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-region-gmina">Gmina (opcjonalnie)</Label>
            <SearchSelect
              id="bulk-region-gmina"
              value={gminaId ? String(gminaId) : null}
              onChange={v => setGminaId(v ? Number(v) : null)}
              disabled={!powiatId}
              placeholder={powiatId ? 'Wybierz gminę' : 'Najpierw wybierz powiat'}
              noneLabel="— bez gminy —"
              options={gminy.map(g => ({ value: String(g.id), label: g.name }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Anuluj
          </Button>
          <Button onClick={handleConfirm} disabled={isPending || !powiatId}>
            {isPending ? 'Zapisywanie…' : 'Zastosuj'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

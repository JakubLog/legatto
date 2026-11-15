import { Loader2, Send } from 'lucide-react';
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
import { useMarkInterpellationSent } from '@/hooks/useInterpellations';
import { errorMessage } from '@/lib/errors';
import type { Interpellation } from '@/integrations/supabase/types';

interface Props {
  item: Pick<Interpellation, 'id' | 'subject'> | null;
  onClose: () => void;
}

/** Potwierdzenie: zaakceptowana -> wysłana (koniec obiegu). */
export function MarkSentDialog({ item, onClose }: Props) {
  const sentMut = useMarkInterpellationSent();

  const handleConfirm = async () => {
    if (!item) return;
    try {
      await sentMut.mutateAsync(item.id);
      toast.success('Interpelacja oznaczona jako wysłana');
      onClose();
    } catch (err) {
      toast.error('Nie udało się oznaczyć jako wysłanej', { description: errorMessage(err) });
    }
  };

  return (
    <Dialog open={Boolean(item)} onOpenChange={(o) => !o && !sentMut.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex-row items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Send className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 space-y-1.5">
            <DialogTitle>Oznaczyć jako wysłaną?</DialogTitle>
            <DialogDescription>
              {item && <span className="block break-words font-medium text-foreground">„{item.subject}”</span>}
              Potwierdź, że interpelacja została wysłana. To kończy jej obieg.
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={sentMut.isPending}>
            Anuluj
          </Button>
          <Button onClick={handleConfirm} disabled={sentMut.isPending}>
            {sentMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Oznacz jako wysłaną
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

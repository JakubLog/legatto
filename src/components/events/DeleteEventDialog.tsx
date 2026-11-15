import { Loader2, Trash2 } from 'lucide-react';
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
import { useDeleteEvent } from '@/hooks/useEvents';
import type { CalendarEventWithRelations } from '@/integrations/supabase/types';

interface Props {
  event: CalendarEventWithRelations | null;
  onClose: () => void;
}

export function DeleteEventDialog({ event, onClose }: Props) {
  const deleteMut = useDeleteEvent();

  const handleDelete = async () => {
    if (!event) return;
    try {
      await deleteMut.mutateAsync(event.id);
      toast.success('Wydarzenie usunięte');
      onClose();
    } catch (err) {
      toast.error('Błąd usuwania', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  return (
    <Dialog open={Boolean(event)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex-row items-start gap-3 space-y-0 text-left">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Trash2 className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 space-y-1.5">
            <DialogTitle>Usunąć wydarzenie?</DialogTitle>
            <DialogDescription>
              {event && (
                <>
                  <span className="font-medium text-foreground">„{event.title}”</span> zostanie trwale usunięte. Tej
                  operacji nie można cofnąć.
                </>
              )}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={deleteMut.isPending}>
            Anuluj
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteMut.isPending}>
            {deleteMut.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Usuń
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { useDeleteBudgetReport } from '@/hooks/useBudgetReports';
import { useMovedToTrashToast } from '@/hooks/useTrash';
import type { BudgetReportWithCreator } from '@/integrations/supabase/types';
import { errorMessage } from '@/lib/errors';
import { formatReportDate } from './reportUtils';

interface Props {
  report: BudgetReportWithCreator | null;
  onClose: () => void;
}

export function DeleteBudgetReportDialog({ report, onClose }: Props) {
  const deleteMut = useDeleteBudgetReport();
  const movedToTrash = useMovedToTrashToast();

  const handleDelete = async () => {
    if (!report) return;
    try {
      await deleteMut.mutateAsync(report.id);
      movedToTrash('budget_report', report.id);
      onClose();
    } catch (err) {
      toast.error('Błąd usuwania', { description: errorMessage(err) });
    }
  };

  return (
    <Dialog open={Boolean(report)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader className="flex-row items-start gap-3 space-y-0 text-left">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Trash2 className="h-5 w-5" />
          </span>
          <div className="space-y-1.5">
            <DialogTitle>Przenieść raport AI do kosza?</DialogTitle>
            <DialogDescription>
              {report
                ? `Raport z ${formatReportDate(report.created_at)} trafi do kosza. Wydatki pozostaną bez zmian. Przez 7 dni można go przywrócić, potem zostanie usunięty trwale.`
                : ''}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" onClick={onClose} disabled={deleteMut.isPending}>
            Anuluj
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteMut.isPending}>
            {deleteMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Przenieś do kosza
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

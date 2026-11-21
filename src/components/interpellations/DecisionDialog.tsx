import { useState } from 'react';
import { addDays, format } from 'date-fns';
import { pl } from 'date-fns/locale';
import type { LucideIcon } from 'lucide-react';
import { Archive, CheckCircle2, Loader2, MessageSquareText } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { useDecideInterpellation } from '@/hooks/useInterpellations';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import type { Interpellation, InterpellationDecision } from '@/integrations/supabase/types';

const NOTES_MAX = 5000;

interface DecisionConfig {
  title: string;
  description: string;
  confirm: string;
  success: string;
  icon: LucideIcon;
  iconClassName: string;
  destructive: boolean;
  /** Etykieta pola uwag; brak = decyzja bez komentarza. */
  notesLabel: string | null;
  notesRequired: boolean;
}

const CONFIG: Record<InterpellationDecision, DecisionConfig> = {
  zaakceptowana: {
    title: 'Zaakceptować interpelację?',
    description:
      'Interpelacja przejdzie do etapu „Zaakceptowana, czeka na wysłanie”. Od akceptacji jest 24 h na jej wysłanie.',
    confirm: 'Akceptuj',
    success: 'Interpelacja zaakceptowana. Termin wysłania: 24 h.',
    icon: CheckCircle2,
    iconClassName: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    destructive: false,
    notesLabel: null,
    notesRequired: false,
  },
  uwagi: {
    title: 'Zgłoś uwagi',
    description: 'Pracownik zobaczy uwagi, poprawi interpelację i wgra nową wersję.',
    confirm: 'Przekaż uwagi',
    success: 'Uwagi przekazane pracownikowi',
    icon: MessageSquareText,
    iconClassName: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    destructive: false,
    notesLabel: 'Uwagi dla pracownika',
    notesRequired: true,
  },
  odrzucona: {
    title: 'Odrzucić interpelację?',
    description: 'Interpelacja trafi do archiwum i zakończy obieg.',
    confirm: 'Odrzuć',
    success: 'Interpelacja odrzucona i przeniesiona do archiwum',
    icon: Archive,
    iconClassName: 'bg-destructive/10 text-destructive',
    destructive: true,
    notesLabel: 'Powód odrzucenia (opcjonalnie)',
    notesRequired: false,
  },
};

interface Props {
  item: Pick<Interpellation, 'id' | 'subject'>;
  /** Otwarta decyzja; null = dialog zamknięty. */
  decision: InterpellationDecision | null;
  onClose: () => void;
}

/** Potwierdzenie decyzji Posła: akceptacja, uwagi (wymagane) albo odrzucenie (opcjonalny powód). */
export function DecisionDialog({ item, decision, onClose }: Props) {
  const decideMut = useDecideInterpellation();
  const [notes, setNotes] = useState('');
  const config = decision ? CONFIG[decision] : null;
  const trimmed = notes.trim();
  const invalid = Boolean(config?.notesRequired && trimmed.length === 0) || notes.length > NOTES_MAX;

  const close = () => {
    if (decideMut.isPending) return;
    setNotes('');
    onClose();
  };

  const handleConfirm = async () => {
    if (!decision || !config || invalid) return;
    try {
      await decideMut.mutateAsync({
        id: item.id,
        decision,
        notes: config.notesLabel && trimmed ? trimmed : null,
      });
      toast.success(config.success);
      setNotes('');
      onClose();
    } catch (err) {
      toast.error('Nie udało się zapisać decyzji', { description: errorMessage(err) });
    }
  };

  const Icon = config?.icon;

  return (
    <Dialog open={Boolean(config)} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        {config && Icon && (
          <>
            <DialogHeader className="flex-row items-start gap-4">
              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', config.iconClassName)}>
                <Icon className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <DialogTitle>{config.title}</DialogTitle>
                <DialogDescription>
                  <span className="block break-words font-medium text-foreground">„{item.subject}”</span>
                  {config.description}
                  {decision === 'zaakceptowana' && (
                    <span className="mt-1 block">
                      Termin wysłania:{' '}
                      <span className="font-medium text-foreground">
                        {format(addDays(new Date(), 1), 'EEEE, d MMMM, HH:mm', { locale: pl })}
                      </span>
                    </span>
                  )}
                </DialogDescription>
              </div>
            </DialogHeader>

            {config.notesLabel && (
              <div className="space-y-1.5">
                <Label htmlFor="decision-notes">{config.notesLabel}</Label>
                <Textarea
                  id="decision-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={NOTES_MAX}
                  rows={6}
                  autoFocus
                  required={config.notesRequired}
                  placeholder={
                    config.notesRequired ? 'Co trzeba poprawić w treści interpelacji?' : 'Dlaczego interpelacja jest odrzucana?'
                  }
                />
                <p className="text-right text-xs tabular-nums text-muted-foreground">
                  {notes.length} / {NOTES_MAX}
                </p>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={close} disabled={decideMut.isPending}>
                Anuluj
              </Button>
              <Button
                variant={config.destructive ? 'destructive' : 'default'}
                onClick={handleConfirm}
                disabled={decideMut.isPending || invalid}
              >
                {decideMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {config.confirm}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

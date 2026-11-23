import { useState } from 'react';
import { AlertTriangle, CalendarDays, ChevronDown, Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DangerTitleIcon } from '@/components/admin/AdminUi';

import { useCreateIcsSource, useDeleteIcsSource, type IcsSource } from '@/hooks/useIcsSources';
import { RUNTIME_CONFIG } from '@/lib/runtime-config';
import { cn } from '@/lib/utils';

// Na serwerze biura egress przepuszcza tylko hosty zatwierdzone przez admina (ICS_ALLOWED_HOSTS);
// null = bez listy (Vercel). Ten sam warunek sprawdza serwer przy synchronizacji.
const ICS_HOSTS = RUNTIME_CONFIG.icsAllowedHosts;

function icsHostAllowed(value: string): boolean {
  if (ICS_HOSTS === null) return true;
  try {
    return ICS_HOSTS.includes(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

const addSchema = z.object({
  name: z.string().min(1, 'Nazwa jest wymagana').max(80),
  url: z
    .string()
    .url('Podaj poprawny URL')
    .refine((v) => v.includes('.ics') || v.includes('ical') || v.includes('webcal'), {
      message: 'URL powinien wskazywać na plik ICS / iCal',
    })
    .refine(icsHostAllowed, {
      message: `Host kalendarza spoza listy dozwolonych na serwerze biura (${ICS_HOSTS?.join(', ') || 'lista pusta'}).`,
    }),
});
type AddForm = z.infer<typeof addSchema>;

function GoogleHint() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-muted/30 text-sm text-muted-foreground">
      <button
        type="button"
        className="flex min-h-10 w-full items-center justify-between px-3 py-2 text-left font-medium text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Jak uzyskać prywatny link ICS?
        <ChevronDown
          className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open && (
        <ol className="list-decimal space-y-1.5 border-t px-3 py-3 pl-7">
          <li>Otwórz Google Calendar → kliknij ⋮ przy kalendarzu → <strong>Ustawienia</strong></li>
          <li>Przewiń do sekcji <strong>Integruj kalendarz</strong></li>
          <li>Skopiuj <strong>Tajny adres w formacie iCal</strong></li>
          <li>Wklej ten URL poniżej. Link jest prywatny — zachowaj go w tajemnicy.</li>
        </ol>
      )}
    </div>
  );
}

export function AddIcsSourceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateIcsSource();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddForm>({ resolver: zodResolver(addSchema) });

  const onSubmit = async (data: AddForm) => {
    await create.mutateAsync(data);
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v: boolean) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            Dodaj źródło kalendarza ICS
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ics-name">Nazwa</Label>
            <Input id="ics-name" placeholder="np. Kalendarz główny" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ics-url">URL (link ICS / iCal)</Label>
            <Input
              id="ics-url"
              type="url"
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              {...register('url')}
            />
            {errors.url && <p className="text-xs text-destructive">{errors.url.message}</p>}
            {ICS_HOSTS !== null && (
              <p className="text-xs text-muted-foreground">
                Dozwolone hosty: {ICS_HOSTS.join(', ') || 'brak - admin biura dodaje je w panelu serwera'}.
              </p>
            )}
          </div>
          <GoogleHint />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>
              Anuluj
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Dodaj
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteIcsSourceDialog({ source, onClose }: { source: IcsSource | null; onClose: () => void }) {
  const del = useDeleteIcsSource();

  const handleConfirm = async () => {
    if (!source) return;
    await del.mutateAsync(source.id);
    onClose();
  };

  return (
    <Dialog open={Boolean(source)} onOpenChange={(v: boolean) => { if (!v) onClose(); }}>
      {source && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <DangerTitleIcon icon={AlertTriangle} />
              Usunąć źródło kalendarza?
            </DialogTitle>
            <DialogDescription>
              Usunięcie źródła <strong>{source.name}</strong> spowoduje usunięcie powiązanych
              importowanych wydarzeń z kalendarza. Tej operacji nie można cofnąć.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={del.isPending}>
              Anuluj
            </Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={del.isPending}>
              {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Usuń
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

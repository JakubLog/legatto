import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, Loader2 } from 'lucide-react';
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
import { useClearPrivacyPin, useSetPrivacyPin } from '@/hooks/usePrivacyPin';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useMpForms } from '@/hooks/useMpForms';

const pinField = z
  .string()
  .regex(/^\d+$/, 'PIN moze zawierac tylko cyfry')
  .min(4, 'Min. 4 cyfry')
  .max(8, 'Max. 8 cyfr');

// Zmiana / usuniecie istniejacego PIN-u wymaga podania obecnego (weryfikacja i limit prob w DB).
function buildSchema(requireCurrent: boolean) {
  return z
    .object({
      current: requireCurrent ? pinField : z.string(),
      pin: pinField,
      confirm: z.string(),
    })
    .refine((v) => v.pin === v.confirm, { path: ['confirm'], message: 'PIN-y sa rozne' });
}

interface Values {
  current: string;
  pin: string;
  confirm: string;
}

const PIN_INPUT_CLASS = 'h-10 rounded-xl text-center font-mono text-lg tracking-[0.4em] indent-[0.4em] max-md:h-12 max-md:text-xl';

interface PrivacySetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PrivacySetupDialog({ open, onOpenChange }: PrivacySetupDialogProps) {
  const setPin = useSetPrivacyPin();
  const clearPin = useClearPrivacyPin();
  const { isPinSet, lock, unlock } = usePrivacy();
  const mp = useMpForms();
  const schema = useMemo(() => buildSchema(isPinSet), [isPinSet]);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { current: '', pin: '', confirm: '' },
  });

  useEffect(() => {
    if (!open) form.reset();
  }, [open, form]);

  const pending = setPin.isPending || clearPin.isPending;

  const onSubmit = async (values: Values) => {
    try {
      if (isPinSet) {
        await setPin.mutateAsync({ pin: values.pin, currentPin: values.current });
        toast.success('PIN trybu prywatnego zmieniony');
      } else {
        await setPin.mutateAsync({ pin: values.pin });
        toast.success('Tryb prywatny aktywowany', {
          description: 'Ekran zostal zaslony. Wprowadz PIN zeby kontynuowac.',
        });
        lock();
      }
      onOpenChange(false);
    } catch (err) {
      form.setValue('current', '');
      toast.error(isPinSet ? 'Nie udalo sie zmienic PIN-u' : 'Nie udalo sie ustawic PIN-u', {
        description: err instanceof Error ? err.message : 'Nieznany blad',
      });
    }
  };

  const handleClear = async () => {
    if (!(await form.trigger('current'))) return;
    try {
      await clearPin.mutateAsync(form.getValues('current'));
      unlock();
      toast.success('PIN trybu prywatnego usuniety');
      onOpenChange(false);
    } catch (err) {
      form.setValue('current', '');
      toast.error('Nie udalo sie usunac PIN-u', {
        description: err instanceof Error ? err.message : 'Nieznany blad',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl sm:rounded-2xl">
        <DialogHeader className="space-y-3 sm:text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Eye className="h-6 w-6" aria-hidden="true" />
          </div>
          <DialogTitle className="text-center text-xl font-semibold tracking-tight">
            {isPinSet ? 'PIN trybu prywatnego' : 'Włącz tryb prywatny'}
          </DialogTitle>
          <DialogDescription className="text-center">
            {isPinSet
              ? 'Aby zmienić lub usunąć PIN, podaj najpierw obecny PIN.'
              : 'Tryb prywatny pozwala szybko zasłonić ekran (np. gdy ktoś staje za Tobą). Po włączeniu cały portal zostanie zasłonięty, a do odsłony będzie potrzebny poniższy PIN.'}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
          PIN jest <strong className="font-medium text-foreground">inny niż Twoje hasło do logowania</strong>. Służy
          wyłącznie do szybkiego odsłaniania ekranu. Po 5 błędnych próbach PIN blokuje się na 15 minut. Jeśli go
          zapomnisz, wyloguj się i poproś {mp.accusative} o resetowanie.
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {isPinSet && (
            <div className="space-y-1.5">
              <Label htmlFor="privacy-pin-current">Obecny PIN</Label>
              <Input
                id="privacy-pin-current"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                autoComplete="off"
                autoFocus
                className={PIN_INPUT_CLASS}
                {...form.register('current')}
              />
              {form.formState.errors.current && (
                <p className="text-xs text-destructive">{form.formState.errors.current.message}</p>
              )}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="privacy-pin">{isPinSet ? 'Nowy PIN (4-8 cyfr)' : 'PIN (4-8 cyfr)'}</Label>
              <Input
                id="privacy-pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                autoComplete="off"
                autoFocus={!isPinSet}
                className={PIN_INPUT_CLASS}
                {...form.register('pin')}
              />
              {form.formState.errors.pin && (
                <p className="text-xs text-destructive">{form.formState.errors.pin.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="privacy-pin-confirm">Powtórz PIN</Label>
              <Input
                id="privacy-pin-confirm"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                autoComplete="off"
                className={PIN_INPUT_CLASS}
                {...form.register('confirm')}
              />
              {form.formState.errors.confirm && (
                <p className="text-xs text-destructive">{form.formState.errors.confirm.message}</p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 max-md:!flex-col-reverse max-md:!gap-3 max-md:!space-x-0">
            {isPinSet && (
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:text-destructive max-md:w-full md:mr-auto"
                disabled={pending}
                onClick={() => void handleClear()}
              >
                {clearPin.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Usuń PIN
              </Button>
            )}
            <Button type="button" variant="outline" className="max-md:w-full" onClick={() => onOpenChange(false)}>
              Anuluj
            </Button>
            <Button type="submit" className="max-md:w-full" disabled={pending}>
              {setPin.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {isPinSet ? 'Zmień PIN' : 'Zapisz i zasłoń'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

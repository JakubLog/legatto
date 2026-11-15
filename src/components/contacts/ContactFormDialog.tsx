import { useEffect, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodFormResolver } from '@/lib/zodForm';
import { z } from 'zod';
import { Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchSelect } from '@/components/ui/search-select';

import { CONTACT_TYPES, CONTACT_TYPE_LABELS } from '@/lib/contacts';
import { usePowiaty } from '@/hooks/usePowiaty';
import { useGminy } from '@/hooks/useGminy';
import { useCreateContact, useUpdateContact, type ContactInput } from '@/hooks/useContacts';
import { useGRSyncContact, useGRUnsyncContact } from '@/hooks/useGetResponse';
import type { ContactType, ContactWithRelations } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';

const schema = z.object({
  type: z.enum(['wyborca', 'dziennikarz', 'samorządowiec', 'sołtys', 'inne']),
  first_name: z.string().min(2, 'Min. 2 znaki'),
  last_name: z.string().min(2, 'Min. 2 znaki'),
  function: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Nieprawidłowy email').optional().or(z.literal('')),
  powiat_id: z.coerce.number().int().positive('Wybierz powiat'),
  gmina_id: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
  miejscowosc: z.string().optional(),
  street: z.string().optional(),
  postal_code: z.string().optional(),
  notes: z.string().optional(),
  newsletter_consent: z.boolean().default(false),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: ContactWithRelations | null;
  onCreated?: (contactId: string) => void;
}

export function ContactFormDialog({ open, onOpenChange, contact, onCreated }: Props) {
  const { data: powiaty } = usePowiaty();
  const createMut = useCreateContact();
  const updateMut = useUpdateContact();
  const syncMut = useGRSyncContact();
  const unsyncMut = useGRUnsyncContact();

  const form = useForm<FormValues>({
    resolver: zodFormResolver(schema),
    defaultValues: {
      type: 'wyborca',
      first_name: '',
      last_name: '',
      function: '',
      phone: '',
      email: '',
      powiat_id: 0 as unknown as number,
      gmina_id: undefined,
      miejscowosc: '',
      street: '',
      postal_code: '',
      notes: '',
      newsletter_consent: false,
    },
  });

  const powiatId = form.watch('powiat_id');
  const { data: gminy } = useGminy(powiatId || null);

  useEffect(() => {
    if (open) {
      if (contact) {
        form.reset({
          type: contact.type,
          first_name: contact.first_name,
          last_name: contact.last_name,
          function: contact.function ?? '',
          phone: contact.phone ?? '',
          email: contact.email ?? '',
          powiat_id: contact.powiat_id,
          gmina_id: contact.gmina_id ?? undefined,
          miejscowosc: contact.miejscowosc ?? '',
          street: contact.street ?? '',
          postal_code: contact.postal_code ?? '',
          notes: contact.notes ?? '',
          newsletter_consent: contact.newsletter_consent ?? false,
        });
      } else {
        form.reset({
          type: 'wyborca',
          first_name: '',
          last_name: '',
          function: '',
          phone: '',
          email: '',
          powiat_id: 0 as unknown as number,
          gmina_id: undefined,
          miejscowosc: '',
          street: '',
          postal_code: '',
          notes: '',
          newsletter_consent: false,
        });
      }
    }
  }, [open, contact, form]);

  const isEdit = Boolean(contact);
  const submitting = createMut.isPending || updateMut.isPending;

  const handleGRSync = async (
    values: FormValues,
    savedContactId: string,
  ) => {
    const prevConsent = contact?.newsletter_consent ?? false;
    const newConsent = values.newsletter_consent;

    // Edycja bez zmiany zgody — nic nie rób
    if (isEdit && prevConsent === newConsent) return;
    // Nowy kontakt bez zgody — nic nie rób (nie ma czego usuwać z GR)
    if (!isEdit && !newConsent) return;

    if (newConsent) {
      // Zaznaczono → dodaj do GR
      const email = values.email?.trim();
      if (!email) {
        toast.warning('Zgoda na newsletter zapisana, ale brak adresu email — kontakt nie trafił do GetResponse.');
        return;
      }
      try {
        await syncMut.mutateAsync({
          contact_id: savedContactId,
          email,
          name: `${values.first_name.trim()} ${values.last_name.trim()}`,
        });
        toast.success('Kontakt dodany do listy GetResponse');
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('GR_NOT_CONFIGURED') || msg.includes('nie jest skonfigurowany')) return;
        toast.error('Nie udało się dodać do GetResponse', { description: msg || undefined });
      }
    } else {
      // Odznaczono → usuń z GR
      try {
        await unsyncMut.mutateAsync({ contact_id: savedContactId });
        toast.success('Kontakt usunięty z listy GetResponse');
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('GR_NOT_CONFIGURED') || msg.includes('nie jest skonfigurowany')) return;
        toast.error('Nie udało się usunąć z GetResponse', { description: msg || undefined });
      }
    }
  };

  const onSubmit = async (values: FormValues) => {
    const payload: ContactInput = {
      type: values.type,
      first_name: values.first_name.trim(),
      last_name: values.last_name.trim(),
      function: values.function?.trim() || null,
      phone: values.phone?.trim() || null,
      email: values.email?.trim() || null,
      powiat_id: values.powiat_id,
      gmina_id: values.gmina_id ?? null,
      miejscowosc: values.miejscowosc?.trim() || null,
      street: values.street?.trim() || null,
      postal_code: values.postal_code?.trim() || null,
      notes: values.notes?.trim() || null,
      tags: [],
      newsletter_consent: values.newsletter_consent,
    };

    try {
      let savedId: string;
      if (isEdit && contact) {
        await updateMut.mutateAsync({ id: contact.id, ...payload });
        savedId = contact.id;
        toast.success('Kontakt zaktualizowany');
      } else {
        const created = await createMut.mutateAsync(payload);
        savedId = created.id;
        toast.success('Kontakt dodany');
        onCreated?.(savedId);
      }
      onOpenChange(false);

      // GR sync/unsync — fire-and-forget po zamknięciu dialogu
      void handleGRSync(values, savedId);
    } catch (err) {
      toast.error('Błąd zapisu', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const newsletterConsent = form.watch('newsletter_consent');
  const emailValue = form.watch('email');
  const hasEmail = Boolean(emailValue?.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edytuj kontakt' : 'Nowy kontakt'}</DialogTitle>
          <DialogDescription>
            Wymagane: typ, imię, nazwisko, powiat. Reszta opcjonalna.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormSection title="Osoba">
            <div className="space-y-1.5 max-md:col-span-2">
              <Label>Typ *</Label>
              <Select
                value={form.watch('type')}
                onValueChange={(v) => form.setValue('type', v as ContactType, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {CONTACT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 max-md:col-span-2">
              <Label htmlFor="function">Funkcja</Label>
              <Input id="function" placeholder="np. wójt, redaktor" {...form.register('function')} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="first_name">Imię *</Label>
              <Input id="first_name" {...form.register('first_name')} />
              {form.formState.errors.first_name && (
                <p className="text-xs text-destructive">{form.formState.errors.first_name.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="last_name">Nazwisko *</Label>
              <Input id="last_name" {...form.register('last_name')} />
              {form.formState.errors.last_name && (
                <p className="text-xs text-destructive">{form.formState.errors.last_name.message}</p>
              )}
            </div>
          </FormSection>

          <FormSection title="Kontakt">
            <div className="space-y-1.5 max-md:col-span-2">
              <Label htmlFor="phone">Telefon</Label>
              <Input id="phone" type="tel" autoComplete="off" {...form.register('phone')} />
            </div>

            <div className="space-y-1.5 max-md:col-span-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="off" {...form.register('email')} />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>

            {/* Zgoda na newsletter */}
            <div className="col-span-2">
              <label
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 transition-colors max-md:min-h-11',
                  !hasEmail
                    ? 'cursor-not-allowed bg-muted/30 opacity-60'
                    : newsletterConsent
                      ? 'cursor-pointer border-emerald-500/40 bg-emerald-500/10'
                      : 'cursor-pointer hover:bg-muted/60',
                )}
              >
                <input
                  type="checkbox"
                  {...form.register('newsletter_consent')}
                  disabled={!hasEmail}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600 disabled:cursor-not-allowed"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Mail className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    Zgoda na newsletter
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {hasEmail
                      ? 'Kontakt zostanie automatycznie dodany do listy mailingowej GetResponse. Odznaczenie spowoduje usunięcie z listy.'
                      : 'Uzupełnij adres e-mail, aby móc zapisać zgodę na newsletter.'}
                  </p>
                </div>
              </label>
            </div>
          </FormSection>

          <FormSection title="Adres i region">
            <div className="space-y-1.5 max-md:col-span-2">
              <Label htmlFor="contact-powiat">Powiat *</Label>
              <SearchSelect
                id="contact-powiat"
                value={powiatId ? String(powiatId) : null}
                onChange={(v) => {
                  form.setValue('powiat_id', v ? Number(v) : (0 as unknown as number), { shouldValidate: true });
                  form.setValue('gmina_id', undefined);
                }}
                placeholder="Wybierz powiat"
                options={(powiaty ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
              />
              {form.formState.errors.powiat_id && (
                <p className="text-xs text-destructive">{form.formState.errors.powiat_id.message}</p>
              )}
            </div>

            <div className="space-y-1.5 max-md:col-span-2">
              <Label htmlFor="contact-gmina">Gmina</Label>
              <SearchSelect
                id="contact-gmina"
                value={form.watch('gmina_id') ? String(form.watch('gmina_id')) : null}
                onChange={(v) =>
                  form.setValue('gmina_id', v ? Number(v) : undefined, {
                    shouldValidate: true,
                  })
                }
                disabled={!powiatId}
                placeholder={powiatId ? 'Wybierz (opcjonalnie)' : 'Wybierz powiat'}
                noneLabel="- brak -"
                options={(gminy ?? []).map((g) => ({ value: String(g.id), label: g.name }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="miejscowosc">Miejscowość</Label>
              <Input id="miejscowosc" placeholder="np. nazwa wsi" {...form.register('miejscowosc')} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="postal_code">Kod pocztowy</Label>
              <Input id="postal_code" placeholder="np. 10-001" {...form.register('postal_code')} />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="street">Ulica</Label>
              <Input id="street" {...form.register('street')} />
            </div>
          </FormSection>

          <FormSection title="Notatki">
            <div className="col-span-2">
              <Label htmlFor="notes" className="sr-only">Notatki</Label>
              <Textarea id="notes" rows={3} {...form.register('notes')} />
            </div>
          </FormSection>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Anuluj
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? 'Zapisz zmiany' : 'Dodaj kontakt'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 text-xs font-semibold text-muted-foreground">{title}</legend>
      {/* Telefon: pary krótkich pól (imię/nazwisko, miejscowość/kod) obok siebie, reszta na pełną szerokość. */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-4 md:gap-4">{children}</div>
    </fieldset>
  );
}

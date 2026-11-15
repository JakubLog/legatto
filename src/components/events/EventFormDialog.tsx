import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodFormResolver } from '@/lib/zodForm';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
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
import { SearchSelect, type SearchSelectOption } from '@/components/ui/search-select';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { useAuth } from '@/contexts/AuthContext';
import { groupUsersByOffice } from '@/lib/assignableUsers.utils';

import { EVENT_TYPES, EVENT_TYPE_DOT, EVENT_TYPE_LABELS } from '@/lib/events';
import { usePowiaty } from '@/hooks/usePowiaty';
import { useGminy } from '@/hooks/useGminy';
import { useAssignableUsers } from '@/hooks/useUsers';
import { useContacts } from '@/hooks/useContacts';
import { useCases } from '@/hooks/useCases';
import { useCreateEvent, useUpdateEvent, type EventInput } from '@/hooks/useEvents';
import type { CalendarEventWithRelations, EventType } from '@/integrations/supabase/types';

const NONE_LABEL = '- brak -';
const SECTION_TITLE = 'text-xs font-semibold text-muted-foreground';

const schema = z
  .object({
    title: z.string().min(2, 'Min. 2 znaki'),
    description: z.string().optional(),
    type: z.enum(['spotkanie', 'wyjazd', 'media', 'inne']),
    all_day: z.boolean(),
    is_public: z.boolean(),
    starts_at: z.string().min(1, 'Wymagane'),
    ends_at: z.string().optional(),
    location: z.string().optional(),
    powiat_id: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
    gmina_id: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
    case_id: z.guid().optional().or(z.literal('').transform(() => undefined)),
    contact_id: z.guid().optional().or(z.literal('').transform(() => undefined)),
    assigned_to: z.guid().optional().or(z.literal('').transform(() => undefined)),
  })
  .superRefine((val, ctx) => {
    if (val.ends_at && val.ends_at <= val.starts_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ends_at'],
        message: 'Koniec musi być później niż start',
      });
    }
  });

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: CalendarEventWithRelations | null;
  defaultDate?: Date | null; // dla "Dodaj" z konkretnego dnia w siatce
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultStart(date: Date): string {
  // 09:00 lokalnie tego dnia
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T09:00`;
}

function buildDefaults(date: Date): FormValues {
  return {
    title: '',
    description: '',
    type: 'spotkanie',
    all_day: false,
    is_public: false,
    starts_at: defaultStart(date),
    ends_at: '',
    location: '',
    powiat_id: undefined,
    gmina_id: undefined,
    case_id: undefined,
    contact_id: undefined,
    assigned_to: undefined,
  };
}

export function EventFormDialog({ open, onOpenChange, event, defaultDate }: Props) {
  const { profile } = useAuth();
  const { data: powiaty } = usePowiaty();
  const { data: users } = useAssignableUsers();
  const [contactSearch, setContactSearch] = useState('');
  const [caseSearch, setCaseSearch] = useState('');
  const contactsQ = useContacts({ search: contactSearch });
  const casesQ = useCases({ search: caseSearch });
  const createMut = useCreateEvent();
  const updateMut = useUpdateEvent();

  const form = useForm<FormValues>({
    resolver: zodFormResolver(schema),
    defaultValues: buildDefaults(new Date()),
  });

  const powiatId = form.watch('powiat_id');
  const allDay = form.watch('all_day');
  const { data: gminy } = useGminy(powiatId ?? null);

  const powiatOptions = useMemo<SearchSelectOption[]>(
    () => (powiaty ?? []).map((p) => ({ value: String(p.id), label: p.name })),
    [powiaty],
  );
  const gminaOptions = useMemo<SearchSelectOption[]>(
    () => (gminy ?? []).map((g) => ({ value: String(g.id), label: g.name })),
    [gminy],
  );
  const caseOptions = useMemo<SearchSelectOption[]>(
    () => (casesQ.data ?? []).map((c) => ({ value: c.id, label: c.title })),
    [casesQ.data],
  );
  const contactOptions = useMemo<SearchSelectOption[]>(
    () =>
      (contactsQ.data?.contacts ?? []).map((c) => ({
        value: c.id,
        label: `${c.first_name} ${c.last_name}`.trim(),
        description: [c.function, c.powiat?.name].filter(Boolean).join(' · ') || undefined,
      })),
    [contactsQ.data],
  );
  const userOptions = useMemo<SearchSelectOption[]>(
    () =>
      groupUsersByOffice(users ?? [], profile?.office_id).flatMap((g) =>
        g.users.map((u) => ({
          value: u.id,
          label: u.full_name,
          group: g.label,
          icon: <CreatorAvatar name={u.full_name} avatarUrl={u.avatar_url} className="h-5 w-5 ring-0" />,
        })),
      ),
    [users, profile?.office_id],
  );
  // Powiązane rekordy edytowanego wydarzenia mogą być spoza bieżących wyników wyszukiwania.
  const eventCaseOption: SearchSelectOption | null = event?.case
    ? { value: event.case.id, label: event.case.title }
    : null;
  const eventContactOption: SearchSelectOption | null = event?.contact
    ? { value: event.contact.id, label: `${event.contact.first_name} ${event.contact.last_name}`.trim() }
    : null;

  useEffect(() => {
    if (!open) return;
    setContactSearch('');
    setCaseSearch('');
    if (event) {
      form.reset({
        title: event.title,
        description: event.description ?? '',
        type: event.type,
        all_day: event.all_day,
        is_public: event.is_public ?? false,
        starts_at: toLocalInput(event.starts_at),
        ends_at: event.ends_at ? toLocalInput(event.ends_at) : '',
        location: event.location ?? '',
        powiat_id: event.powiat_id ?? undefined,
        gmina_id: event.gmina_id ?? undefined,
        case_id: event.case_id ?? undefined,
        contact_id: event.contact_id ?? undefined,
        assigned_to: event.assigned_to ?? undefined,
      });
    } else {
      form.reset(buildDefaults(defaultDate ?? new Date()));
    }
  }, [open, event, defaultDate, form]);

  const isEdit = Boolean(event);
  const submitting = createMut.isPending || updateMut.isPending;

  const onSubmit = async (values: FormValues) => {
    let startsAt = values.starts_at;
    let endsAt: string | null = values.ends_at ? values.ends_at : null;

    if (values.all_day) {
      const day = startsAt.slice(0, 10);
      startsAt = `${day}T00:00`;
      endsAt = `${day}T23:59`;
    }

    const payload: EventInput = {
      title: values.title.trim(),
      description: values.description?.trim() || null,
      type: values.type,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      all_day: values.all_day,
      location: values.location?.trim() || null,
      powiat_id: values.powiat_id ?? null,
      gmina_id: values.gmina_id ?? null,
      case_id: values.case_id ?? null,
      contact_id: values.contact_id ?? null,
      assigned_to: values.assigned_to ?? null,
      is_public: values.is_public,
    };

    try {
      if (isEdit && event) {
        await updateMut.mutateAsync({ id: event.id, ...payload });
        toast.success('Wydarzenie zaktualizowane');
      } else {
        await createMut.mutateAsync(payload);
        toast.success('Wydarzenie dodane');
      }
      onOpenChange(false);
    } catch (err) {
      toast.error('Błąd zapisu', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edytuj wydarzenie' : 'Nowe wydarzenie'}</DialogTitle>
          <DialogDescription>Wymagane: tytuł, typ, data rozpoczęcia.</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-3">
            <h3 className={SECTION_TITLE}>Szczegóły</h3>
            <div className="space-y-1.5">
              <Label htmlFor="title">Tytuł *</Label>
              <Input id="title" {...form.register('title')} />
              {form.formState.errors.title && (
                <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Typ *</Label>
                <Select
                  value={form.watch('type')}
                  onValueChange={(v) => form.setValue('type', v as EventType, { shouldValidate: true })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        <span className="inline-flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${EVENT_TYPE_DOT[t]}`} aria-hidden />
                          {EVENT_TYPE_LABELS[t]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="location">Miejsce</Label>
                <Input id="location" placeholder="np. Kraków, Urząd Miasta" {...form.register('location')} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Opis</Label>
              <Textarea id="description" rows={3} {...form.register('description')} />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className={SECTION_TITLE}>Termin</h3>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Label className="flex cursor-pointer items-center gap-2 max-md:min-h-10">
                <input
                  id="all_day"
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-primary max-md:h-5 max-md:w-5"
                  checked={allDay}
                  onChange={(e) => form.setValue('all_day', e.target.checked, { shouldValidate: true })}
                />
                Cały dzień
              </Label>
              <Label className="flex cursor-pointer items-center gap-2 max-md:min-h-10">
                <input
                  id="is_public"
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-primary max-md:h-5 max-md:w-5"
                  checked={form.watch('is_public')}
                  onChange={(e) => form.setValue('is_public', e.target.checked, { shouldValidate: true })}
                />
                Pokaż publicznie na stronie głównej
              </Label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="starts_at">Rozpoczęcie *</Label>
                <Input
                  id="starts_at"
                  type={allDay ? 'date' : 'datetime-local'}
                  {...form.register('starts_at')}
                />
                {form.formState.errors.starts_at && (
                  <p className="text-xs text-destructive">{form.formState.errors.starts_at.message}</p>
                )}
              </div>

              {!allDay && (
                <div className="space-y-1.5">
                  <Label htmlFor="ends_at">Zakończenie</Label>
                  <Input id="ends_at" type="datetime-local" {...form.register('ends_at')} />
                  {form.formState.errors.ends_at && (
                    <p className="text-xs text-destructive">{form.formState.errors.ends_at.message}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className={SECTION_TITLE}>Lokalizacja</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="event-powiat">Powiat</Label>
                <SearchSelect
                  id="event-powiat"
                  value={powiatId ? String(powiatId) : null}
                  onChange={(v) => {
                    form.setValue('powiat_id', v ? Number(v) : undefined);
                    form.setValue('gmina_id', undefined);
                  }}
                  options={powiatOptions}
                  noneLabel={NONE_LABEL}
                  placeholder="Wybierz"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-gmina">Gmina</Label>
                <SearchSelect
                  id="event-gmina"
                  value={form.watch('gmina_id') ? String(form.watch('gmina_id')) : null}
                  onChange={(v) => form.setValue('gmina_id', v ? Number(v) : undefined)}
                  options={gminaOptions}
                  noneLabel={NONE_LABEL}
                  placeholder={powiatId ? 'Wybierz' : 'Wybierz powiat'}
                  disabled={!powiatId}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className={SECTION_TITLE}>Powiązania</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="event-case">Powiązana sprawa</Label>
                <SearchSelect
                  id="event-case"
                  value={form.watch('case_id')}
                  onChange={(v) => form.setValue('case_id', v ?? undefined)}
                  options={caseOptions}
                  selectedOption={eventCaseOption}
                  onSearchChange={setCaseSearch}
                  loading={casesQ.isFetching}
                  noneLabel={NONE_LABEL}
                  placeholder="Brak"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-contact">Kontakt</Label>
                <SearchSelect
                  id="event-contact"
                  value={form.watch('contact_id')}
                  onChange={(v) => form.setValue('contact_id', v ?? undefined)}
                  options={contactOptions}
                  selectedOption={eventContactOption}
                  onSearchChange={setContactSearch}
                  loading={contactsQ.isFetching}
                  noneLabel={NONE_LABEL}
                  placeholder="Brak"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-assignee">Przypisz do</Label>
              <SearchSelect
                id="event-assignee"
                value={form.watch('assigned_to')}
                onChange={(v) => form.setValue('assigned_to', v ?? undefined)}
                options={userOptions}
                noneLabel={NONE_LABEL}
                placeholder="Brak"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 border-t pt-4 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Anuluj
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? 'Zapisz' : 'Dodaj'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

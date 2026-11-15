import { useMemo, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { ArrowLeft, UserPlus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/search-select';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { useContacts } from '@/hooks/useContacts';
import type { ContactWithRelations } from '@/integrations/supabase/types';
import type { CaseFormValues, ReporterMode } from './caseFormSchema';

interface Props {
  form: UseFormReturn<CaseFormValues>;
  mode: ReporterMode;
  onModeChange: (mode: ReporterMode) => void;
  onRemove: () => void;
  onCreateContact: () => void;
}

const LINK = 'inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline max-md:min-h-10 max-md:text-sm';

/** Osoba zgłaszająca: wybór z bazy kontaktów albo dane wpisane ręcznie. */
export function CaseReporterSection({ form, mode, onModeChange, onRemove, onCreateContact }: Props) {
  const [contactSearch, setContactSearch] = useState('');
  // Wybrany kontakt zapamiętany osobno, bo lista wyników zależy od wpisanego tekstu.
  const [pickedContact, setPickedContact] = useState<ContactWithRelations | null>(null);
  const contactId = form.watch('contact_id');
  const { data: contactsPage, isFetching } = useContacts({ search: contactSearch });
  const contactsList = useMemo(() => contactsPage?.contacts ?? [], [contactsPage]);
  const selectedContact = useMemo(
    () =>
      (contactId && pickedContact?.id === contactId ? pickedContact : null) ??
      contactsList.find((c) => c.id === contactId) ??
      null,
    [contactsList, contactId, pickedContact],
  );
  const contactOptions = useMemo<SearchSelectOption[]>(
    () =>
      contactsList.map((c) => {
        const name = `${c.first_name} ${c.last_name}`;
        return {
          value: c.id,
          label: name,
          description: [c.function, c.phone, c.email].filter(Boolean).join(' • ') || undefined,
          icon: <CreatorAvatar name={name} className="h-5 w-5 ring-0" fallbackClassName="text-[9px]" />,
        };
      }),
    [contactsList],
  );

  const pickContact = (id: string | null) => {
    setPickedContact(contactsList.find((c) => c.id === id) ?? null);
    form.setValue('contact_id', id ?? undefined);
  };

  return (
    <section className="space-y-3 rounded-lg border bg-muted/40 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Osoba zgłaszająca</h3>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground max-md:-my-2 max-md:-mr-2 max-md:min-h-10 max-md:px-2 max-md:text-sm"
          onClick={onRemove}
        >
          Usuń
        </button>
      </div>

      {selectedContact ? (
        <div className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
          <CreatorAvatar
            name={`${selectedContact.first_name} ${selectedContact.last_name}`}
            className="h-9 w-9"
            fallbackClassName="text-xs"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {selectedContact.first_name} {selectedContact.last_name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {[selectedContact.function, selectedContact.phone, selectedContact.email]
                .filter(Boolean)
                .join(' • ') || 'Wybrany z bazy kontaktów'}
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => {
              form.setValue('contact_id', undefined);
              setPickedContact(null);
              setContactSearch('');
            }}
            aria-label="Usuń wybór kontaktu"
          >
            <X />
          </Button>
        </div>
      ) : mode === 'search' ? (
        <>
          <SearchSelect
            value={contactId ?? null}
            onChange={pickContact}
            options={contactOptions}
            onSearchChange={setContactSearch}
            loading={isFetching}
            placeholder="Wpisz imię, nazwisko lub funkcję..."
            emptyText="Nie znaleziono. Wpisz dane ręcznie lub dodaj nowy kontakt."
            aria-label="Wyszukaj kontakt"
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="button" className={LINK} onClick={() => onModeChange('manual')}>
              Wpisz dane ręcznie
            </button>
            <button type="button" className={LINK} onClick={onCreateContact}>
              <UserPlus className="h-3.5 w-3.5" />
              Dodaj nowy kontakt do bazy
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="reporter_name" className="text-xs text-muted-foreground">
                Imię i nazwisko
              </Label>
              <Input id="reporter_name" className="bg-card" {...form.register('reporter_name')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reporter_phone" className="text-xs text-muted-foreground">
                Telefon
              </Label>
              <Input
                id="reporter_phone"
                type="tel"
                className="bg-card"
                {...form.register('reporter_phone')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reporter_email" className="text-xs text-muted-foreground">
                Email
              </Label>
              <Input
                id="reporter_email"
                type="email"
                className="bg-card"
                {...form.register('reporter_email')}
              />
              {form.formState.errors.reporter_email && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.reporter_email.message}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            className={LINK}
            onClick={() => {
              form.setValue('reporter_name', '');
              form.setValue('reporter_phone', '');
              form.setValue('reporter_email', '');
              onModeChange('search');
            }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Wybierz z bazy kontaktów
          </button>
        </>
      )}
    </section>
  );
}

import { useState } from 'react';
import { Mail, PenLine } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { useBulkEditContacts, type BulkContactPatch } from '@/hooks/useContacts';
import { useGRBulkConsentSync, type GRBulkConsentInput } from '@/hooks/useGetResponse';
import { cn } from '@/lib/utils';

type TextField = 'function' | 'miejscowosc' | 'street' | 'postal_code';

const TEXT_FIELDS: ReadonlyArray<{ key: TextField; label: string; placeholder: string }> = [
  { key: 'function', label: 'Funkcja / stanowisko', placeholder: 'np. Radny gminy' },
  { key: 'miejscowosc', label: 'Miejscowość', placeholder: 'np. Przykładowo' },
  { key: 'street', label: 'Ulica', placeholder: 'np. ul. Mickiewicza 1' },
  { key: 'postal_code', label: 'Kod pocztowy', placeholder: '00-000' },
];

const CHECKBOX = 'h-4 w-4 shrink-0 cursor-pointer rounded border-input accent-primary';

type Enabled = Record<'newsletter' | TextField, boolean>;
const NONE_ENABLED: Enabled = {
  newsletter: false,
  function: false,
  miejscowosc: false,
  street: false,
  postal_code: false,
};
const EMPTY_TEXT: Record<TextField, string> = { function: '', miejscowosc: '', street: '', postal_code: '' };

/** "1 kontakt", "2 kontakty", "5 kontaktów". */
function contactsLabel(n: number): string {
  if (n === 1) return '1 kontakt';
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} kontakty`;
  return `${n} kontaktów`;
}

interface Props {
  ids: string[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}

/** Masowa edycja pól wspólnych (zgoda na newsletter, funkcja, adres) dla zaznaczonych kontaktów. */
export function BulkEditContactsDialog({ ids, open, onOpenChange, onDone }: Props) {
  const [enabled, setEnabled] = useState<Enabled>(NONE_ENABLED);
  const [consent, setConsent] = useState(true);
  const [text, setText] = useState(EMPTY_TEXT);
  const { mutateAsync, isPending } = useBulkEditContacts();
  const grSync = useGRBulkConsentSync();

  const anyEnabled = Object.values(enabled).some(Boolean);

  const reset = () => {
    setEnabled(NONE_ENABLED);
    setConsent(true);
    setText(EMPTY_TEXT);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const toggle = (key: keyof Enabled) => setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));

  const runGrSync = async (input: GRBulkConsentInput) => {
    const id = toast.loading(`GetResponse: synchronizacja (${contactsLabel(input.contacts.length)})…`);
    try {
      const r = await grSync.mutateAsync(input);
      if (r.notConfigured) {
        toast.dismiss(id);
      } else if (r.failed > 0) {
        toast.error(`GetResponse: zsynchronizowano ${r.done}, błędy: ${r.failed}`, { id });
      } else {
        toast.success(
          input.consent
            ? `GetResponse: dodano ${contactsLabel(r.done)} do listy`
            : `GetResponse: usunięto ${contactsLabel(r.done)} z listy`,
          { id },
        );
      }
    } catch {
      toast.error('Nie udało się zsynchronizować z GetResponse', { id });
    }
  };

  const handleConfirm = async () => {
    const patch: BulkContactPatch = {};
    if (enabled.newsletter) patch.newsletter_consent = consent;
    for (const { key } of TEXT_FIELDS) {
      if (enabled[key]) patch[key] = text[key].trim() || null;
    }
    try {
      const result = await mutateAsync({ ids, patch });
      toast.success(`Zaktualizowano ${contactsLabel(result.updated)}`);
      if (result.skippedNoEmail > 0) {
        toast.warning(
          `Zgoda na newsletter pominięta dla ${contactsLabel(result.skippedNoEmail)} bez adresu e-mail`,
        );
      }
      onDone();
      handleOpenChange(false);
      if (result.consentChanged.length > 0) {
        void runGrSync({ consent, contacts: result.consentChanged });
      }
    } catch {
      toast.error('Nie udało się zaktualizować kontaktów');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <PenLine className="h-4 w-4" />
            </span>
            Edytuj pola: {contactsLabel(ids.length)}
          </DialogTitle>
          <DialogDescription>
            Zaznacz pola do zmiany. Pozostałe dane kontaktów zostaną bez zmian.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div
            className={cn(
              'rounded-lg border p-3 transition-colors',
              enabled.newsletter && 'border-primary/30 bg-primary/[0.03]',
            )}
          >
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className={CHECKBOX}
                checked={enabled.newsletter}
                onChange={() => toggle('newsletter')}
              />
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Zgoda na newsletter</span>
            </label>
            {enabled.newsletter && (
              <div className="mt-3 space-y-2 pl-7">
                <div className="inline-flex rounded-lg bg-muted p-1" role="group" aria-label="Zgoda na newsletter">
                  {[
                    { value: true, label: 'Tak' },
                    { value: false, label: 'Nie' },
                  ].map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      aria-pressed={consent === o.value}
                      onClick={() => setConsent(o.value)}
                      className={cn(
                        'min-h-8 rounded-md px-4 py-1 text-xs font-medium transition-colors',
                        consent === o.value
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {consent
                    ? 'Ustaw tylko dla osób, które wyraziły zgodę. Kontakty bez e-maila zostaną pominięte, pozostałe trafią na listę GetResponse.'
                    : 'Kontakty zostaną usunięte z listy GetResponse.'}
                </p>
              </div>
            )}
          </div>

          {TEXT_FIELDS.map(({ key, label, placeholder }) => (
            <div
              key={key}
              className={cn('rounded-lg border p-3 transition-colors', enabled[key] && 'border-primary/30 bg-primary/[0.03]')}
            >
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" className={CHECKBOX} checked={enabled[key]} onChange={() => toggle(key)} />
                <span className="text-sm font-medium">{label}</span>
              </label>
              {enabled[key] && (
                <div className="mt-3 space-y-1 pl-7">
                  <Input
                    aria-label={label}
                    value={text[key]}
                    placeholder={placeholder}
                    onChange={(e) => setText((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">Puste pole wyczyści wartość.</p>
                </div>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Anuluj
          </Button>
          <Button onClick={handleConfirm} disabled={isPending || !anyEnabled}>
            {isPending ? 'Zapisywanie…' : 'Zastosuj'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

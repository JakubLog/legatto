import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { CheckCircle2, Loader2, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SearchSelect } from '@/components/ui/search-select';

import {
  EMPTY_SUBMISSION_INPUT,
  publicSubmissionSchema,
  submissionFormSchema,
  SubmissionError,
  toCanonicalDraft,
  type PublicSubmissionInput,
  type SubmissionStrategy,
} from '@/lib/publicSubmission';
import { zodFormResolver } from '@/lib/zodForm';
import { mpForms } from '@/lib/mpForms';
import type { SiteIdentity } from '@/lib/siteContent';
import type { SiteDictionaries } from '@/lib/siteSnapshot';
import { cn } from '@/lib/utils';
import { publicBtn, publicField } from '@/components/public/styles';
import { TurnstileWidget, type TurnstileHandle } from '@/components/public/TurnstileWidget';

/** `publicField` dla pola `SearchSelect` - klasy trafiają na kontener, więc celujemy w jego `<input>`. */
const publicSelectField =
  '[&_input]:h-auto [&_input]:min-h-11 [&_input]:rounded-lg [&_input]:border-[1.5px] [&_input]:bg-cream [&_input]:pl-3.5 [&_input]:py-3 [&_input]:text-base [&_input]:shadow-none md:[&_input]:text-[15px]';

const fieldLabel = 'text-sm font-semibold text-foreground';
const consentLabel = 'cursor-pointer text-[13px] font-normal leading-relaxed text-muted-foreground';
const checkboxClass = 'mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-input accent-brand';

/** Słowniki formularza (z migawki strony) - tylko pola potrzebne do wyboru. */
export type SubmissionDictionaries = {
  powiaty: Pick<SiteDictionaries['powiaty'][number], 'id' | 'name'>[];
  gminy: Pick<SiteDictionaries['gminy'][number], 'id' | 'powiat_id' | 'name'>[];
  categories: Pick<SiteDictionaries['categories'][number], 'id' | 'name'>[];
};

export interface PublicSubmissionFormProps {
  /** Dane posła do treści zgód. */
  identity: SiteIdentity;
  /** Kolorystyka szablonu strony (widżet Turnstile). */
  colorScheme: 'light' | 'dark';
  /** Powiaty, gminy i kategorie spraw z migawki strony (bez zapytań do bazy). */
  dictionaries: SubmissionDictionaries;
}

interface Props extends PublicSubmissionFormProps {
  /** Sposób wysyłki: `sealedSubmissionStrategy` (strona statyczna) albo `edgeSubmissionStrategy` (SPA). */
  strategy: SubmissionStrategy;
}

export function PublicSubmissionForm({ identity, colorScheme, dictionaries, strategy }: Props) {
  const genitive = identity.mp_name_genitive;
  const mpForm = mpForms(identity.mp_gender).genitive;
  const consentOffice = genitive ? `Biuro Poselskie ${genitive}` : 'Biuro Poselskie';
  const consentMp = genitive ? `${mpForm} ${genitive}` : mpForm.toLowerCase();

  const form = useForm<PublicSubmissionInput>({
    resolver: zodFormResolver(publicSubmissionSchema),
    defaultValues: EMPTY_SUBMISSION_INPUT,
  });

  const { register, handleSubmit, formState, watch, setValue, reset } = form;
  const errors = formState.errors;

  const selectedPowiat = watch('powiat_id');
  const selectedGmina = watch('gmina_id');
  const selectedCategory = watch('category_id');
  const rodoConsent = watch('rodo_consent');
  const consentNewsletter = watch('consent_newsletter');
  const consentContactsDb = watch('consent_contacts_db');

  const powiatOptions = useMemo(
    () => dictionaries.powiaty.map((p) => ({ value: String(p.id), label: p.name })),
    [dictionaries.powiaty],
  );
  const gminaOptions = useMemo(
    () =>
      dictionaries.gminy
        .filter((g) => g.powiat_id === selectedPowiat)
        .map((g) => ({ value: String(g.id), label: g.name })),
    [dictionaries.gminy, selectedPowiat],
  );
  const categoryOptions = useMemo(
    () => dictionaries.categories.map((c) => ({ value: String(c.id), label: c.name })),
    [dictionaries.categories],
  );

  const turnstileRef = useRef<TurnstileHandle>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Wysłane zgłoszenie: `ref` = numer zgłoszenia (strona statyczna) albo null. */
  const [sent, setSent] = useState<{ ref: string | null } | null>(null);

  const onSubmit = async (values: PublicSubmissionInput) => {
    setSubmitError(null);
    if (!turnstileToken) {
      setSubmitError('Potwierdź, że nie jesteś robotem.');
      return;
    }
    setPending(true);
    try {
      const canonical = submissionFormSchema.parse(toCanonicalDraft(values));
      const result = await strategy.submit(canonical, turnstileToken, values.website);
      reset(EMPTY_SUBMISSION_INPUT);
      setSent(result);
    } catch (e) {
      setSubmitError(e instanceof SubmissionError ? e.message : 'Nie udało się wysłać zgłoszenia. Spróbuj ponownie.');
    } finally {
      setPending(false);
      // Token Turnstile jest jednorazowy - kolejna wysyłka wymaga nowego wyzwania.
      turnstileRef.current?.reset();
    }
  };

  if (sent) {
    return (
      <div role="status" className="flex flex-col items-center gap-4 py-8 text-center">
        <CheckCircle2 className="h-12 w-12 text-brand" aria-hidden />
        <div className="space-y-2">
          <h3 className="text-xl font-bold">Zgłoszenie wysłane</h3>
          <p className="text-muted-foreground">Dziękujemy. Biuro zapozna się ze sprawą i skontaktuje się z Tobą.</p>
          {sent.ref && (
            <p className="text-sm text-muted-foreground">
              Numer zgłoszenia: <strong className="font-mono text-base text-foreground">{sent.ref}</strong>
              <br />
              Zachowaj go - ułatwi kontakt z biurem w tej sprawie.
            </p>
          )}
        </div>
        <Button type="button" variant="outline" className={publicBtn.ghost} onClick={() => setSent(null)}>
          Wyślij kolejne zgłoszenie
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {/* Dane osobowe */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="ps-name" className={fieldLabel}>
            Imię i nazwisko <span className="text-destructive">*</span>
          </Label>
          <Input id="ps-name" autoComplete="name" className={publicField} {...register('reporter_name')} />
          {errors.reporter_name && <p className="text-xs text-destructive">{errors.reporter_name.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ps-email" className={fieldLabel}>
            E-mail
          </Label>
          <Input id="ps-email" type="email" autoComplete="email" className={publicField} {...register('reporter_email')} />
          {errors.reporter_email && <p className="text-xs text-destructive">{errors.reporter_email.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ps-phone" className={fieldLabel}>
            Telefon
          </Label>
          <Input id="ps-phone" type="tel" autoComplete="tel" className={publicField} {...register('reporter_phone')} />
          {errors.reporter_phone && <p className="text-xs text-destructive">{errors.reporter_phone.message}</p>}
        </div>
        <p className="text-xs text-muted-foreground md:col-span-2">
          Podaj e-mail lub telefon - jedno z dwóch jest wymagane do kontaktu zwrotnego.
        </p>
      </div>

      {/* Lokalizacja + kategoria */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ps-powiat" className={fieldLabel}>
            Powiat <span className="text-destructive">*</span>
          </Label>
          <SearchSelect
            id="ps-powiat"
            className={publicSelectField}
            value={selectedPowiat ? String(selectedPowiat) : null}
            onChange={(v) => {
              setValue('powiat_id', v ? Number(v) : null, { shouldValidate: true });
              setValue('gmina_id', null);
            }}
            placeholder="Wybierz powiat"
            options={powiatOptions}
          />
          {errors.powiat_id && <p className="text-xs text-destructive">{errors.powiat_id.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ps-gmina" className={fieldLabel}>
            Gmina (opcjonalnie)
          </Label>
          <SearchSelect
            id="ps-gmina"
            className={publicSelectField}
            value={selectedGmina ? String(selectedGmina) : null}
            onChange={(v) => setValue('gmina_id', v ? Number(v) : null)}
            disabled={!selectedPowiat}
            placeholder={selectedPowiat ? 'Wybierz gminę' : 'Najpierw powiat'}
            noneLabel="- nie dotyczy -"
            options={gminaOptions}
          />
          {errors.gmina_id && <p className="text-xs text-destructive">{errors.gmina_id.message}</p>}
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="ps-category" className={fieldLabel}>
            Kategoria sprawy <span className="text-destructive">*</span>
          </Label>
          <SearchSelect
            id="ps-category"
            className={publicSelectField}
            value={selectedCategory ? String(selectedCategory) : null}
            onChange={(v) => setValue('category_id', v ? Number(v) : null, { shouldValidate: true })}
            placeholder="Wybierz kategorię"
            options={categoryOptions}
          />
          {errors.category_id && <p className="text-xs text-destructive">{errors.category_id.message}</p>}
        </div>
      </div>

      {/* Treść */}
      <div className="space-y-1.5">
        <Label htmlFor="ps-title" className={fieldLabel}>
          Tytuł sprawy <span className="text-destructive">*</span>
        </Label>
        <Input
          id="ps-title"
          className={publicField}
          placeholder="np. Brak chodnika przy ul. Słonecznej"
          {...register('title')}
        />
        {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ps-description" className={fieldLabel}>
          Opis sprawy <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="ps-description"
          className={cn(publicField, 'min-h-[140px]')}
          rows={6}
          placeholder="Opisz sytuację. Co się stało, kiedy, gdzie i jakiego wsparcia oczekujesz."
          {...register('description')}
        />
        {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
      </div>

      {/* Zgody */}
      <div className="space-y-4 rounded-lg bg-cream p-4 sm:p-5">
        {/* RODO - wymagane */}
        <div className="flex items-start gap-3">
          <input
            id="ps-rodo"
            type="checkbox"
            checked={rodoConsent}
            onChange={(e) => setValue('rodo_consent', e.target.checked, { shouldValidate: true })}
            className={checkboxClass}
          />
          <Label htmlFor="ps-rodo" className={consentLabel}>
            Wyrażam zgodę na przetwarzanie moich danych osobowych przez {consentOffice} w celu
            rozpatrzenia zgłoszonej sprawy. Dane są przetwarzane zgodnie z RODO, w celach kontaktu
            zwrotnego i prowadzenia korespondencji. <span className="text-destructive">*</span>
          </Label>
        </div>
        {errors.rodo_consent && <p className="text-xs text-destructive">{errors.rodo_consent.message}</p>}

        {/* Newsletter / SMS - opcjonalne */}
        <div className="flex items-start gap-3">
          <input
            id="ps-newsletter"
            type="checkbox"
            checked={consentNewsletter}
            onChange={(e) => setValue('consent_newsletter', e.target.checked)}
            className={checkboxClass}
          />
          <Label htmlFor="ps-newsletter" className={consentLabel}>
            Chcę otrzymywać newsletter oraz wiadomości SMS o działaniach {consentMp} (informacje
            o spotkaniach, inicjatywach i pracy w okręgu).
          </Label>
        </div>

        {/* Baza wyborców - opcjonalne */}
        <div className="flex items-start gap-3">
          <input
            id="ps-contacts-db"
            type="checkbox"
            checked={consentContactsDb}
            onChange={(e) => setValue('consent_contacts_db', e.target.checked)}
            className={checkboxClass}
          />
          <Label htmlFor="ps-contacts-db" className={consentLabel}>
            Wyrażam zgodę na zapisanie moich danych w bazie kontaktów Biura Poselskiego jako
            wyborca, w celu ewentualnego kontaktu w sprawach działań na rzecz Polski.
          </Label>
        </div>
      </div>

      <div className="space-y-3">
        {strategy.turnstileSiteKey ? (
          <div className="space-y-2">
            <TurnstileWidget
              ref={turnstileRef}
              siteKey={strategy.turnstileSiteKey}
              onTokenChange={setTurnstileToken}
              onLoadError={() => setTurnstileFailed(true)}
              theme={colorScheme}
            />
            {turnstileFailed && (
              <p className="text-sm text-destructive">
                Nie udało się załadować zabezpieczenia przed botami. Odśwież stronę i spróbuj ponownie.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-destructive">
            Formularz jest chwilowo niedostępny. Skontaktuj się z biurem telefonicznie lub mailowo.
          </p>
        )}

        {submitError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {submitError}
          </p>
        )}

        <Button
          type="submit"
          variant="brand"
          className={cn(publicBtn.primary, 'w-full')}
          disabled={pending || !turnstileToken}
        >
          {pending ? (
            <>
              <Loader2 className="animate-spin" /> Wysyłanie...
            </>
          ) : (
            <>
              Wyślij zgłoszenie <Send />
            </>
          )}
        </Button>
      </div>

      {/* Honeypot - ukryty input, boty wypełnią. Na końcu, żeby space-y nie dawał odstępu nad pierwszym polem. */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
        {...register('website')}
      />
    </form>
  );
}

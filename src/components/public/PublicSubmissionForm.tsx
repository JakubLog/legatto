import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodFormResolver } from '@/lib/zodForm';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SearchSelect } from '@/components/ui/search-select';

import {
  usePublicCategories,
  usePublicGminy,
  usePublicPowiaty,
} from '@/hooks/usePublicDictionaries';
import { useSubmitPublicCase } from '@/hooks/useSubmitPublicCase';
import { publicSubmissionSchema, type PublicSubmissionInput } from '@/lib/publicSubmission';
import { mpForms } from '@/lib/mpForms';
import type { SiteIdentity } from '@/lib/siteContent';
import { cn } from '@/lib/utils';
import { publicBtn, publicField } from '@/components/public/styles';
import { TURNSTILE_SITE_KEY, TurnstileWidget, type TurnstileHandle } from '@/components/public/TurnstileWidget';

/** `publicField` dla pola `SearchSelect` - klasy trafiają na kontener, więc celujemy w jego `<input>`. */
const publicSelectField =
  '[&_input]:h-auto [&_input]:min-h-11 [&_input]:rounded-lg [&_input]:border-[1.5px] [&_input]:bg-cream [&_input]:pl-3.5 [&_input]:py-3 [&_input]:text-base [&_input]:shadow-none md:[&_input]:text-[15px]';

const fieldLabel = 'text-sm font-semibold text-foreground';
const consentLabel = 'cursor-pointer text-[13px] font-normal leading-relaxed text-muted-foreground';
const checkboxClass = 'mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-input accent-brand';

interface Props {
  /** Dane posła do treści zgód (z useSiteContent). */
  identity: SiteIdentity;
  /** Kolorystyka szablonu strony (widżet Turnstile). */
  colorScheme: 'light' | 'dark';
}

export function PublicSubmissionForm({ identity, colorScheme }: Props) {
  const genitive = identity.mp_name_genitive;
  const mpForm = mpForms(identity.mp_gender).genitive;
  const consentOffice = genitive ? `Biuro Poselskie ${genitive}` : 'Biuro Poselskie';
  const consentMp = genitive ? `${mpForm} ${genitive}` : mpForm.toLowerCase();

  const form = useForm<PublicSubmissionInput>({
    resolver: zodFormResolver(publicSubmissionSchema),
    defaultValues: {
      reporter_name: '',
      reporter_email: '',
      reporter_phone: '',
      powiat_id: undefined as unknown as number,
      gmina_id: null,
      category_id: undefined as unknown as number,
      title: '',
      description: '',
      rodo_consent: false as unknown as true,
      consent_newsletter: false,
      consent_contacts_db: false,
      website: '',
    },
  });

  const { register, handleSubmit, formState, watch, setValue, reset } = form;
  const errors = formState.errors;

  const selectedPowiat = watch('powiat_id');
  const selectedGmina = watch('gmina_id');
  const selectedCategory = watch('category_id');
  const rodoConsent = watch('rodo_consent') as unknown as boolean;
  const consentNewsletter = watch('consent_newsletter') ?? false;
  const consentContactsDb = watch('consent_contacts_db') ?? false;

  const powiatyQ = usePublicPowiaty();
  const gminyQ = usePublicGminy(selectedPowiat || null);
  const categoriesQ = usePublicCategories();

  const submitMut = useSubmitPublicCase();
  const turnstileRef = useRef<TurnstileHandle>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileFailed, setTurnstileFailed] = useState(false);

  const onSubmit = async (values: PublicSubmissionInput) => {
    if (!turnstileToken) {
      toast.error('Potwierdź, że nie jesteś robotem.');
      return;
    }
    try {
      await submitMut.mutateAsync({
        reporter_name: values.reporter_name,
        reporter_email: values.reporter_email?.trim() || null,
        reporter_phone: values.reporter_phone?.trim() || null,
        powiat_id: values.powiat_id,
        gmina_id: values.gmina_id ?? null,
        category_id: values.category_id,
        title: values.title,
        description: values.description,
        rodo_consent: true,
        consent_newsletter: values.consent_newsletter ?? false,
        consent_contacts_db: values.consent_contacts_db ?? false,
        website: values.website,
        turnstile_token: turnstileToken,
      });
      toast.success('Zgłoszenie przyjęte. Skontaktujemy się z Tobą.');
      reset();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Nie udało się wysłać zgłoszenia';
      toast.error(msg);
    } finally {
      // Token Turnstile jest jednorazowy - kolejna wysyłka wymaga nowego wyzwania.
      turnstileRef.current?.reset();
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {/* Dane osobowe */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="ps-name" className={fieldLabel}>
            Imię i nazwisko <span className="text-destructive">*</span>
          </Label>
          <Input id="ps-name" autoComplete="name" className={publicField} {...register('reporter_name')} />
          {errors.reporter_name && (
            <p className="text-xs text-destructive">{errors.reporter_name.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ps-email" className={fieldLabel}>E-mail</Label>
          <Input
            id="ps-email"
            type="email"
            autoComplete="email"
            className={publicField}
            {...register('reporter_email')}
          />
          {errors.reporter_email && (
            <p className="text-xs text-destructive">{errors.reporter_email.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ps-phone" className={fieldLabel}>Telefon</Label>
          <Input id="ps-phone" type="tel" autoComplete="tel" className={publicField} {...register('reporter_phone')} />
          {errors.reporter_phone && (
            <p className="text-xs text-destructive">{errors.reporter_phone.message}</p>
          )}
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
              setValue('powiat_id', v ? Number(v) : (undefined as unknown as number), { shouldValidate: true });
              setValue('gmina_id', null);
            }}
            placeholder="Wybierz powiat"
            loading={powiatyQ.isLoading}
            options={(powiatyQ.data ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
          />
          {errors.powiat_id && (
            <p className="text-xs text-destructive">{errors.powiat_id.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ps-gmina" className={fieldLabel}>Gmina (opcjonalnie)</Label>
          <SearchSelect
            id="ps-gmina"
            className={publicSelectField}
            value={selectedGmina ? String(selectedGmina) : null}
            onChange={(v) => setValue('gmina_id', v ? Number(v) : null)}
            disabled={!selectedPowiat}
            placeholder={selectedPowiat ? 'Wybierz gminę' : 'Najpierw powiat'}
            noneLabel="- nie dotyczy -"
            loading={gminyQ.isLoading}
            options={(gminyQ.data ?? []).map((g) => ({ value: String(g.id), label: g.name }))}
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="ps-category" className={fieldLabel}>
            Kategoria sprawy <span className="text-destructive">*</span>
          </Label>
          <SearchSelect
            id="ps-category"
            className={publicSelectField}
            value={selectedCategory ? String(selectedCategory) : null}
            onChange={(v) =>
              setValue('category_id', v ? Number(v) : (undefined as unknown as number), { shouldValidate: true })
            }
            placeholder="Wybierz kategorię"
            loading={categoriesQ.isLoading}
            options={(categoriesQ.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
          />
          {errors.category_id && (
            <p className="text-xs text-destructive">{errors.category_id.message}</p>
          )}
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
        {errors.description && (
          <p className="text-xs text-destructive">{errors.description.message}</p>
        )}
      </div>

      {/* Zgody */}
      <div className="space-y-4 rounded-lg bg-cream p-4 sm:p-5">
        {/* RODO - wymagane */}
        <div className="flex items-start gap-3">
          <input
            id="ps-rodo"
            type="checkbox"
            checked={rodoConsent}
            onChange={(e) =>
              setValue('rodo_consent', e.target.checked as unknown as true, { shouldValidate: true })
            }
            className={checkboxClass}
          />
          <Label htmlFor="ps-rodo" className={consentLabel}>
            Wyrażam zgodę na przetwarzanie moich danych osobowych przez {consentOffice} w celu
            rozpatrzenia zgłoszonej sprawy. Dane są przetwarzane zgodnie z RODO, w celach kontaktu
            zwrotnego i prowadzenia korespondencji.{' '}
            <span className="text-destructive">*</span>
          </Label>
        </div>
        {errors.rodo_consent && (
          <p className="text-xs text-destructive">{errors.rodo_consent.message as string}</p>
        )}

        {/* Newsletter / SMS - opcjonalne */}
        <div className="flex items-start gap-3">
          <input
            id="ps-newsletter"
            type="checkbox"
            checked={consentNewsletter}
            onChange={(e) => setValue('consent_newsletter', e.target.checked)}
            className={checkboxClass}
          />
          <Label
            htmlFor="ps-newsletter"
            className={consentLabel}
          >
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
          <Label
            htmlFor="ps-contacts-db"
            className={consentLabel}
          >
            Wyrażam zgodę na zapisanie moich danych w bazie kontaktów Biura Poselskiego jako
            wyborca, w celu ewentualnego kontaktu w sprawach działań na rzecz Polski.
          </Label>
        </div>
      </div>

      <div className="space-y-3">
        {TURNSTILE_SITE_KEY ? (
          <div className="space-y-2">
            <TurnstileWidget
              ref={turnstileRef}
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

        <Button
          type="submit"
          variant="brand"
          className={cn(publicBtn.primary, 'w-full')}
          disabled={submitMut.isPending || !turnstileToken}
        >
          {submitMut.isPending ? (
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

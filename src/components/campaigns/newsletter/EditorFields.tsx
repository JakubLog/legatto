import { useState, type ComponentType } from 'react';
import {
  Controller,
  get,
  useFieldArray,
  type FieldPath,
  type UseFormReturn,
} from 'react-hook-form';
import { ChevronDown, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  FACT_CHECK_VERDICTS,
  campaignNameFor,
  type FactCheckVerdict,
  type NewsletterTemplate,
  type SectionKey,
} from '@/lib/newsletter/types';

import { ImageField } from '../ImageField';
import { CalendarImport } from './CalendarImport';
import { AddItemButton, FormField, RepeatableItem } from './primitives';

type Form = UseFormReturn<NewsletterTemplate>;
type FieldsProps = { form: Form };
type Path = FieldPath<NewsletterTemplate>;

const VERDICT_LABELS: Record<FactCheckVerdict, string> = {
  manipulacja: '❌ Manipulacja',
  falsz: '❌ Fałsz',
  czesciowa: '⚠️ Częściowa prawda',
  prawda: '✅ Prawda',
};

const errorOf = (form: Form, path: Path): string | undefined => get(form.formState.errors, path)?.message;

function Image({ form, name, label, description }: FieldsProps & { name: Path; label: string; description?: string }) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <ImageField
          label={label}
          value={typeof field.value === 'string' ? field.value : ''}
          onChange={field.onChange}
          description={description}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}

function RemoveRowButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      aria-label={label}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

// ============================================================================
// Podstawy: temat, preheader, nazwa kampanii
// ============================================================================

const SUBJECT_SOFT_LIMIT = 60;
const PREHEADER_SOFT_LIMIT = 100;

function Counter({ value, soft, max }: { value: string; soft: number; max: number }) {
  const n = value.trim().length;
  return (
    <span className={cn('tabular-nums', n > soft ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
      {n}/{max}
    </span>
  );
}

export function BasicsFields({ form }: FieldsProps) {
  const { register, watch } = form;
  const [advanced, setAdvanced] = useState(false);
  const subject = watch('subject') ?? '';
  const preheader = watch('preheader') ?? '';
  const autoName = campaignNameFor({ campaign_name: '', subject, header: watch('header') });

  return (
    <div className="space-y-3">
      <FormField
        label="Temat maila"
        required
        error={errorOf(form, 'subject')}
        hint={`Najlepiej do ${SUBJECT_SOFT_LIMIT} znaków — dłuższy temat telefon utnie.`}
        aside={<Counter value={subject} soft={SUBJECT_SOFT_LIMIT} max={150} />}
      >
        <Input {...register('subject')} placeholder="np. Tydzień w Sejmie: ustawa o szpitalach" />
      </FormField>
      <FormField
        label="Zajawka w skrzynce (preheader)"
        error={errorOf(form, 'preheader')}
        hint="Szary tekst obok tematu na liście maili. Dopowiedz, co jest w środku."
        aside={<Counter value={preheader} soft={PREHEADER_SOFT_LIMIT} max={150} />}
      >
        <Input {...register('preheader')} placeholder="np. Głosowanie, spotkania w regionie i liczba tygodnia" />
      </FormField>

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        aria-expanded={advanced}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', advanced && 'rotate-180')} />
        Nazwa kampanii w GetResponse
      </button>
      {advanced && (
        <FormField
          error={errorOf(form, 'campaign_name')}
          hint="Widoczna tylko w panelu GetResponse. Zostaw puste, aby użyć nazwy automatycznej."
        >
          <Input {...register('campaign_name')} placeholder={autoName || 'Newsletter …'} />
        </FormField>
      )}
    </div>
  );
}

// ============================================================================
// Nagłówek i stopka (stałe)
// ============================================================================

export function HeaderFields({ form }: FieldsProps) {
  const { register } = form;
  return (
    <div className="space-y-3">
      <Image form={form} name="header.avatar_url" label="Zdjęcie w nagłówku" description="Puste = kółko z inicjałami." />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Data wydania" required error={errorOf(form, 'header.date_label')}>
          <Input {...register('header.date_label')} placeholder="24 marca 2026" />
        </FormField>
        <FormField
          label="Imię odbiorcy w powitaniu"
          hint="[[firstname]] — GetResponse wstawi imię."
          error={errorOf(form, 'header.greeting_first_token')}
        >
          <Input {...register('header.greeting_first_token')} />
        </FormField>
      </div>
      <FormField
        label="Region"
        hint="Obok tytułu posła i jako nazwa sekcji regionalnej. Puste = „Z regionu”."
        error={errorOf(form, 'header.region_label')}
      >
        <Input {...register('header.region_label')} placeholder="np. Mazowsze" maxLength={60} />
      </FormField>
    </div>
  );
}

export function FooterFields({ form }: FieldsProps) {
  const { register } = form;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Wartości domyślne ustawia administrator w Integracje → Stałe newslettera. Zmiany tutaj dotyczą tylko tego wydania.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Nazwa biura" required error={errorOf(form, 'footer.office_name')}>
          <Input {...register('footer.office_name')} />
        </FormField>
        <FormField label="Email kontaktowy" required error={errorOf(form, 'footer.contact_email')}>
          <Input type="email" {...register('footer.contact_email')} />
        </FormField>
      </div>
      <FormField label="Adres biura" error={errorOf(form, 'footer.office_address')}>
        <Input {...register('footer.office_address')} placeholder="ul. Przykładowa 1, 00-001 Warszawa" />
      </FormField>
      <FormField label="Polityka prywatności (URL)" required error={errorOf(form, 'footer.privacy_url')}>
        <Input type="url" {...register('footer.privacy_url')} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ['footer.social_facebook', 'Facebook', 'https://facebook.com/...'],
            ['footer.social_instagram', 'Instagram', 'https://instagram.com/...'],
            ['footer.social_x', 'X (Twitter)', 'https://x.com/...'],
            ['footer.social_tiktok', 'TikTok', 'https://tiktok.com/@...'],
            ['footer.social_youtube', 'YouTube', 'https://youtube.com/@...'],
          ] as const
        ).map(([name, label, placeholder]) => (
          <FormField key={name} label={label} error={errorOf(form, name)}>
            <Input type="url" {...register(name)} placeholder={placeholder} />
          </FormField>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Sekcje wymienne
// ============================================================================

function LeadFields({ form }: FieldsProps) {
  const { register } = form;
  return (
    <div className="space-y-3">
      <FormField label="Tytuł" required error={errorOf(form, 'lead.title')}>
        <Input {...register('lead.title')} placeholder="Najważniejsza sprawa tego tygodnia" />
      </FormField>
      <FormField label="Opis" required error={errorOf(form, 'lead.description')} hint="2–3 zdania zachęcające do kliknięcia.">
        <Textarea {...register('lead.description')} rows={3} />
      </FormField>
      <Image form={form} name="lead.image_url" label="Zdjęcie" description="Szerokie, najlepiej 1120 × 640 px." />
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <FormField label="Link do artykułu" error={errorOf(form, 'lead.link_url')} hint="Bez linku przycisk się nie pokaże.">
          <Input {...register('lead.link_url')} placeholder="https://..." />
        </FormField>
        <FormField label="Napis na przycisku" error={errorOf(form, 'lead.cta_label')}>
          <Input {...register('lead.cta_label')} placeholder="Czytaj więcej" />
        </FormField>
      </div>
    </div>
  );
}

const VOTE_COLUMNS = [
  ['za', 'Za'],
  ['przeciw', 'Prz.'],
  ['wstrzymal', 'Wstrz.'],
  ['nieobecny', 'Nieob.'],
] as const;

function SejmFields({ form }: FieldsProps) {
  const { register } = form;
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'sejm.clubs' });
  return (
    <div className="space-y-3">
      <FormField label="Tytuł głosowania" required error={errorOf(form, 'sejm.title')}>
        <Input {...register('sejm.title')} placeholder="Ustawa o ... — głosowanie nad całością" />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Posiedzenie / data" hint="np. Posiedzenie nr 12 · 20 marca 2026">
          <Input {...register('sejm.sitting_label')} />
        </FormField>
        <FormField label="Link do głosowania" error={errorOf(form, 'sejm.vote_link')}>
          <Input {...register('sejm.vote_link')} placeholder="https://www.sejm.gov.pl/..." />
        </FormField>
      </div>

      <FormField label="Głosy klubów" hint="Kluby z samymi zerami nie trafią do maila.">
        <div className="space-y-1.5 rounded-lg border bg-muted/20 p-2">
          <div className="grid grid-cols-[1fr_repeat(4,52px)_28px] gap-1.5 px-1 text-[11px] font-medium text-muted-foreground">
            <span>Klub</span>
            {VOTE_COLUMNS.map(([, label]) => (
              <span key={label} className="text-center">
                {label}
              </span>
            ))}
            <span />
          </div>
          {fields.map((f, index) => (
            <div key={f.id} className="grid grid-cols-[1fr_repeat(4,52px)_28px] items-center gap-1.5">
              <Input className="h-8" {...register(`sejm.clubs.${index}.name` as const)} placeholder="Klub" />
              {VOTE_COLUMNS.map(([col, label]) => (
                <Input
                  key={col}
                  className="h-8 px-1 text-center tabular-nums"
                  type="number"
                  min={0}
                  aria-label={`${label} — klub ${index + 1}`}
                  {...register(`sejm.clubs.${index}.${col}` as const, { valueAsNumber: true })}
                />
              ))}
              <RemoveRowButton onClick={() => remove(index)} label="Usuń klub" />
            </div>
          ))}
          {fields.length < 12 && (
            <AddItemButton onClick={() => append({ name: '', za: 0, przeciw: 0, wstrzymal: 0, nieobecny: 0 })} label="Dodaj klub" />
          )}
        </div>
      </FormField>

      <FormField label="Mój komentarz" error={errorOf(form, 'sejm.comment')}>
        <Textarea {...register('sejm.comment')} rows={3} placeholder="Dlaczego głosowałem tak, a nie inaczej..." />
      </FormField>
      <FormField label="Link „Wszystkie głosowania”" error={errorOf(form, 'sejm.all_votes_link')}>
        <Input {...register('sejm.all_votes_link')} placeholder="https://..." />
      </FormField>
    </div>
  );
}

function CommentaryFields({ form }: FieldsProps) {
  const { register } = form;
  return (
    <div className="space-y-3">
      <FormField label="Tytuł" error={errorOf(form, 'commentary.title')}>
        <Input {...register('commentary.title')} />
      </FormField>
      <FormField label="Wyróżnione zdanie" error={errorOf(form, 'commentary.highlight')} hint="Pojawi się dużą czcionką na różowym tle.">
        <Textarea {...register('commentary.highlight')} rows={2} />
      </FormField>
      <FormField label="Treść" required error={errorOf(form, 'commentary.body')} hint="Pusta linia = nowy akapit.">
        <Textarea {...register('commentary.body')} rows={6} />
      </FormField>
    </div>
  );
}

function RegionNewsFields({ form }: FieldsProps) {
  const { register } = form;
  return (
    <div className="space-y-3">
      <FormField label="Tytuł" required error={errorOf(form, 'region_news.title')}>
        <Input {...register('region_news.title')} />
      </FormField>
      <Image form={form} name="region_news.image_url" label="Zdjęcie" />
      <FormField label="Treść" error={errorOf(form, 'region_news.body')} hint="Pusta linia = nowy akapit.">
        <Textarea {...register('region_news.body')} rows={5} />
      </FormField>
    </div>
  );
}

function ExpertFields({ form }: FieldsProps) {
  const { register } = form;
  return (
    <div className="space-y-3">
      <FormField label="Tytuł" error={errorOf(form, 'expert.title')}>
        <Input {...register('expert.title')} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Tag 1" hint="np. ZDROWIE">
          <Input {...register('expert.tag1')} />
        </FormField>
        <FormField label="Tag 2" hint="np. CYFRYZACJA">
          <Input {...register('expert.tag2')} />
        </FormField>
      </div>
      <FormField label="Treść" required error={errorOf(form, 'expert.body')} hint="Pusta linia = nowy akapit.">
        <Textarea {...register('expert.body')} rows={6} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <FormField label="Link do raportu" error={errorOf(form, 'expert.link_url')}>
          <Input {...register('expert.link_url')} placeholder="https://..." />
        </FormField>
        <FormField label="Napis linku">
          <Input {...register('expert.link_label')} />
        </FormField>
      </div>
    </div>
  );
}

function NumberFields({ form }: FieldsProps) {
  const { register } = form;
  return (
    <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
      <FormField label="Liczba" required error={errorOf(form, 'number_of_week.value')}>
        <Input {...register('number_of_week.value')} placeholder="47 234" className="text-lg font-semibold md:text-lg" />
      </FormField>
      <FormField label="Co oznacza?" error={errorOf(form, 'number_of_week.context')}>
        <Textarea {...register('number_of_week.context')} rows={2} placeholder="tyle osób czeka na ..." />
      </FormField>
    </div>
  );
}

function MediaFields({ form }: FieldsProps) {
  const { register, control } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'media.items' });
  return (
    <div className="space-y-3">
      {fields.map((f, index) => (
        <RepeatableItem key={f.id} index={index} canRemove={fields.length > 1} onRemove={() => remove(index)}>
          <FormField label="Tytuł wystąpienia / artykułu" error={errorOf(form, `media.items.${index}.title`)}>
            <Input {...register(`media.items.${index}.title` as const)} placeholder="Wywiad w Gościu Wydarzeń" />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Link" error={errorOf(form, `media.items.${index}.link_url`)}>
              <Input {...register(`media.items.${index}.link_url` as const)} placeholder="https://..." />
            </FormField>
            <FormField label="Medium i data" hint="np. TVP Info · 20 marca">
              <Input {...register(`media.items.${index}.outlet_date` as const)} />
            </FormField>
          </div>
          <Image form={form} name={`media.items.${index}.image_url`} label="Miniaturka (opcjonalnie)" />
        </RepeatableItem>
      ))}
      {fields.length < 10 && (
        <AddItemButton onClick={() => append({ image_url: '', title: '', link_url: '', outlet_date: '' })} label="Dodaj wystąpienie" />
      )}
    </div>
  );
}

function ReelFields({ form }: FieldsProps) {
  const { register } = form;
  return (
    <div className="space-y-3">
      <Image form={form} name="reel.image_url" label="Kadr z wideo" description="Pionowy, np. 600 × 760 px." />
      <FormField label="Tytuł / krótki opis" error={errorOf(form, 'reel.title')}>
        <Input {...register('reel.title')} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Link Instagram" error={errorOf(form, 'reel.instagram_url')}>
          <Input {...register('reel.instagram_url')} placeholder="https://instagram.com/..." />
        </FormField>
        <FormField label="Link TikTok" error={errorOf(form, 'reel.tiktok_url')}>
          <Input {...register('reel.tiktok_url')} placeholder="https://tiktok.com/..." />
        </FormField>
      </div>
    </div>
  );
}

function EventsFields({ form }: FieldsProps) {
  const { register, control } = form;
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'events.items' });
  return (
    <div className="space-y-3">
      <CalendarImport
        onImport={(items) => {
          const kept = form.getValues('events.items').filter((i) => i.title.trim());
          replace([...kept, ...items].slice(0, 10));
        }}
      />
      {fields.map((f, index) => (
        <RepeatableItem key={f.id} index={index} canRemove={fields.length > 1} onRemove={() => remove(index)}>
          <div className="grid gap-3 sm:grid-cols-[72px_80px_1fr]">
            <FormField label="Dzień">
              <Input {...register(`events.items.${index}.day` as const)} placeholder="27" />
            </FormField>
            <FormField label="Miesiąc">
              <Input {...register(`events.items.${index}.month` as const)} placeholder="MAR" />
            </FormField>
            <FormField label="Nazwa wydarzenia" error={errorOf(form, `events.items.${index}.title`)}>
              <Input {...register(`events.items.${index}.title` as const)} placeholder="Spotkanie z mieszkańcami" />
            </FormField>
          </div>
          <FormField label="Miejsce i godzina">
            <Input {...register(`events.items.${index}.location` as const)} placeholder="📍 Warszawa, ul. Przykładowa 10 · godz. 17:00" />
          </FormField>
          <FormField label="Temat (opcjonalnie)">
            <Input {...register(`events.items.${index}.detail` as const)} placeholder="Temat: opieka zdrowotna" />
          </FormField>
        </RepeatableItem>
      ))}
      {fields.length < 10 && (
        <AddItemButton onClick={() => append({ day: '', month: '', title: '', location: '', detail: '' })} label="Dodaj wydarzenie" />
      )}
    </div>
  );
}

function ReaderQuestionFields({ form }: FieldsProps) {
  const { register, control } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'reader_question.options' });
  return (
    <div className="space-y-3">
      <FormField label="Pytanie" required error={errorOf(form, 'reader_question.question')}>
        <Textarea {...register('reader_question.question')} rows={2} placeholder="Czy uważasz, że...?" />
      </FormField>
      <FormField label="Odpowiedzi" hint="Każda odpowiedź to przycisk z linkiem (np. do ankiety). Pierwsza jest wyróżniona.">
        <div className="space-y-1.5">
          {fields.map((f, index) => (
            <div key={f.id} className="grid grid-cols-[1fr_1.4fr_28px] items-start gap-1.5">
              <Input className="h-8" {...register(`reader_question.options.${index}.label` as const)} placeholder="👍 Tak" />
              <div>
                <Input className="h-8" {...register(`reader_question.options.${index}.link_url` as const)} placeholder="https://..." />
                {errorOf(form, `reader_question.options.${index}.link_url`) && (
                  <p className="mt-1 text-xs text-destructive">{errorOf(form, `reader_question.options.${index}.link_url`)}</p>
                )}
              </div>
              <RemoveRowButton onClick={() => remove(index)} label="Usuń odpowiedź" />
            </div>
          ))}
          {fields.length < 4 && <AddItemButton onClick={() => append({ label: '', link_url: '' })} label="Dodaj odpowiedź" />}
        </div>
      </FormField>
    </div>
  );
}

function FactCheckFields({ form }: FieldsProps) {
  const { register, control } = form;
  return (
    <div className="space-y-3">
      <FormField label="Sprawdzane stwierdzenie" required error={errorOf(form, 'fact_check.statement')}>
        <Textarea {...register('fact_check.statement')} rows={2} placeholder="Nakłady wzrosły o 50% w ciągu dwóch lat" />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <FormField label="Kto i gdzie to powiedział" hint="np. Premier, konferencja, 18.03.2026">
          <Input {...register('fact_check.statement_source')} />
        </FormField>
        <FormField label="Werdykt">
          <Controller
            control={control}
            name="fact_check.verdict"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FACT_CHECK_VERDICTS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {VERDICT_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
      </div>
      <FormField label="Wyjaśnienie z danymi" required error={errorOf(form, 'fact_check.explanation')}>
        <Textarea {...register('fact_check.explanation')} rows={4} placeholder="Według danych GUS/NFZ..." />
      </FormField>
      <FormField label="Link do źródła" error={errorOf(form, 'fact_check.source_link')}>
        <Input {...register('fact_check.source_link')} placeholder="https://..." />
      </FormField>
    </div>
  );
}

function GalleryFields({ form }: FieldsProps) {
  const { register, control } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'gallery.images' });
  return (
    <div className="space-y-3">
      <FormField label="Podpis sekcji">
        <Input {...register('gallery.label')} placeholder="Z tego tygodnia" />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f, index) => (
          <div key={f.id} className="relative">
            <Image form={form} name={`gallery.images.${index}.url`} label={`Zdjęcie ${index + 1}`} />
            {fields.length > 1 && (
              <div className="absolute right-0 top-0">
                <RemoveRowButton onClick={() => remove(index)} label={`Usuń zdjęcie ${index + 1}`} />
              </div>
            )}
          </div>
        ))}
      </div>
      {fields.length < 8 && <AddItemButton onClick={() => append({ url: '' })} label="Dodaj zdjęcie" />}
    </div>
  );
}

function QuoteFields({ form }: FieldsProps) {
  const { register } = form;
  return (
    <div className="space-y-3">
      <FormField label="Cytat" required error={errorOf(form, 'quote.body')} hint="Bez cudzysłowów — dodamy je automatycznie.">
        <Textarea {...register('quote.body')} rows={3} />
      </FormField>
      <FormField label="Autor" error={errorOf(form, 'quote.author')}>
        <Input {...register('quote.author')} placeholder="np. imię i nazwisko autora" />
      </FormField>
    </div>
  );
}

function RecommendFields({ form }: FieldsProps) {
  const { register, control } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'recommend.items' });
  return (
    <div className="space-y-3">
      {fields.map((f, index) => (
        <RepeatableItem key={f.id} index={index} canRemove={fields.length > 1} onRemove={() => remove(index)}>
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <FormField label="Rodzaj" hint="Książka / Podcast / Artykuł">
              <Input {...register(`recommend.items.${index}.kind` as const)} />
            </FormField>
            <FormField label="Tytuł" error={errorOf(form, `recommend.items.${index}.title`)}>
              <Input {...register(`recommend.items.${index}.title` as const)} />
            </FormField>
          </div>
          <FormField label="Link" error={errorOf(form, `recommend.items.${index}.link_url`)}>
            <Input {...register(`recommend.items.${index}.link_url` as const)} placeholder="https://..." />
          </FormField>
          <FormField label="Dlaczego warto?">
            <Textarea {...register(`recommend.items.${index}.description` as const)} rows={2} />
          </FormField>
          <Image form={form} name={`recommend.items.${index}.image_url`} label="Okładka (opcjonalnie)" />
        </RepeatableItem>
      ))}
      {fields.length < 6 && (
        <AddItemButton onClick={() => append({ image_url: '', kind: '', title: '', link_url: '', description: '' })} label="Dodaj rekomendację" />
      )}
    </div>
  );
}

export const SECTION_FIELDS: Record<SectionKey, ComponentType<FieldsProps>> = {
  lead: LeadFields,
  sejm: SejmFields,
  commentary: CommentaryFields,
  region_news: RegionNewsFields,
  expert: ExpertFields,
  number_of_week: NumberFields,
  media: MediaFields,
  reel: ReelFields,
  events: EventsFields,
  reader_question: ReaderQuestionFields,
  fact_check: FactCheckFields,
  gallery: GalleryFields,
  quote: QuoteFields,
  recommend: RecommendFields,
};

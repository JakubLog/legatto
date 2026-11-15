import { AlertTriangle, CheckCircle2, CircleAlert, Loader2, TestTube2, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchSelect } from '@/components/ui/search-select';
import { cn } from '@/lib/utils';
import type { PreviewBlockKey } from '@/lib/newsletter/render';
import type { NewsletterTemplate } from '@/lib/newsletter/types';

import { FormField } from './primitives';
import { SECTION_META, pluralize } from './sections';

// ============================================================================
// Krok 2: sprawdzenie przed wysyłką, odbiorcy, mail testowy
// ============================================================================

const SUBJECT_SOFT_LIMIT = 60;

interface CheckItem {
  ok: boolean;
  text: string;
  /** Sekcja do poprawienia - przycisk "Popraw" otwiera ją w edytorze. */
  fix?: PreviewBlockKey;
}

function buildChecklist(t: NewsletterTemplate, testSentTo: string | null): CheckItem[] {
  const active = (key: keyof typeof SECTION_META) => t.sections.includes(key);
  const subjectLength = t.subject.trim().length;
  const items: CheckItem[] = [
    subjectLength <= SUBJECT_SOFT_LIMIT
      ? { ok: true, text: 'Temat mieści się na ekranie telefonu' }
      : { ok: false, text: `Temat ma ${subjectLength} znaków — na telefonie zostanie ucięty` },
    t.preheader.trim()
      ? { ok: true, text: 'Zajawka w skrzynce uzupełniona' }
      : { ok: false, text: 'Brak zajawki — skrzynka pokaże przypadkowy początek treści' },
  ];

  const imageSections = [
    ['lead', t.lead.image_url],
    ['region_news', t.region_news.image_url],
    ['reel', t.reel.image_url],
  ] as const;
  for (const [key, url] of imageSections) {
    if (active(key) && !url?.trim()) {
      items.push({ ok: false, text: `„${SECTION_META[key].label}” nie ma zdjęcia`, fix: key });
    }
  }
  if (active('lead') && !t.lead.link_url?.trim()) {
    items.push({ ok: false, text: 'Temat tygodnia bez linku — przycisk „Czytaj więcej” nie pojawi się', fix: 'lead' });
  }
  if (active('reader_question') && t.reader_question.options.some((o) => o.label.trim() && !o.link_url?.trim())) {
    items.push({ ok: false, text: 'Odpowiedzi w ankiecie bez linków nie będą klikalne', fix: 'reader_question' });
  }

  items.push(
    testSentTo
      ? { ok: true, text: `Mail testowy wysłany na ${testSentTo}` }
      : { ok: false, text: 'Nie wysłano maila testowego — sprawdź, jak mail wygląda w Twojej skrzynce' },
  );
  return items;
}

interface Props {
  values: NewsletterTemplate;
  onFix: (key: PreviewBlockKey) => void;
  selectedListId: string;
  onListChange: (id: string) => void;
  selectedFromFieldId: string;
  onFromFieldChange: (id: string) => void;
  campaigns: Array<{ campaignId: string; name: string }>;
  campaignsLoading: boolean;
  fromFields: Array<{ fromFieldId: string; name: string; email: string }>;
  fromFieldsLoading: boolean;
  campaignName: string;
  consentCount: number | null;
  testEmail: string;
  onTestEmailChange: (v: string) => void;
  onSendTest: () => void;
  testPending: boolean;
  testSentTo: string | null;
}

export function SendStep({
  values,
  onFix,
  selectedListId,
  onListChange,
  selectedFromFieldId,
  onFromFieldChange,
  campaigns,
  campaignsLoading,
  fromFields,
  fromFieldsLoading,
  campaignName,
  consentCount,
  testEmail,
  onTestEmailChange,
  onSendTest,
  testPending,
  testSentTo,
}: Props) {
  const checklist = buildChecklist(values, testSentTo);
  const warnings = checklist.filter((c) => !c.ok).length;

  return (
    <div className="space-y-5 p-5">
      <section className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Sprawdź przed wysyłką</h3>
          <span
            className={cn(
              'ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold',
              warnings === 0
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
            )}
          >
            {warnings === 0 ? 'Wszystko gotowe' : pluralize(warnings, 'uwaga', 'uwagi', 'uwag')}
          </span>
        </div>
        <ul className="divide-y">
          {checklist.map((item) => (
            <li key={item.text} className="flex items-start gap-2.5 px-4 py-2 text-sm">
              {item.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              )}
              <span className={cn('min-w-0 flex-1', item.ok && 'text-muted-foreground')}>{item.text}</span>
              {item.fix && (
                <button
                  type="button"
                  onClick={() => onFix(item.fix!)}
                  className="shrink-0 text-xs font-medium text-primary hover:underline"
                >
                  Popraw
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          Uwagi nie blokują wysyłki. Nazwa w GetResponse: <span className="font-medium text-foreground">{campaignName}</span>
        </p>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="text-sm font-semibold">Odbiorcy i nadawca</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Lista odbiorców GetResponse" required>
            <SearchSelect
              value={selectedListId || null}
              onChange={(v) => onListChange(v ?? '')}
              disabled={campaignsLoading}
              loading={campaignsLoading}
              noneLabel="(brak)"
              placeholder={campaignsLoading ? 'Ładuję listy...' : 'Wybierz listę'}
              aria-label="Lista odbiorców GetResponse"
              options={campaigns.map((c) => ({ value: c.campaignId, label: c.name }))}
            />
          </FormField>

          <FormField label="Nadawca" required>
            <SearchSelect
              value={selectedFromFieldId || null}
              onChange={(v) => onFromFieldChange(v ?? '')}
              disabled={fromFieldsLoading}
              loading={fromFieldsLoading}
              noneLabel="(brak)"
              placeholder={fromFieldsLoading ? 'Ładuję adresy...' : 'Wybierz adres'}
              aria-label="Nadawca"
              options={fromFields.map((f) => ({ value: f.fromFieldId, label: `${f.name} (${f.email})` }))}
            />
          </FormField>
        </div>
        <div className="flex items-center gap-2.5 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            {consentCount === null ? (
              '…'
            ) : (
              <span className="font-semibold">{pluralize(consentCount, 'kontakt', 'kontakty', 'kontaktów')}</span>
            )}{' '}
            w ePośle ma zgodę na newsletter
            <span className="text-muted-foreground"> · liczba w GetResponse może się różnić</span>
          </span>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <TestTube2 className="h-4 w-4 text-primary" />
          Mail testowy
          {testSentTo && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> wysłany
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Trafi <strong>tylko na ten adres</strong>, z tematem poprzedzonym [TEST]. Adres zostanie dodany do wybranej
          listy w GetResponse. Bez prawa wysyłki newslettera test można wysłać tylko na adres swojego konta; limit 10
          testów na godzinę.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            value={testEmail}
            onChange={(e) => onTestEmailChange(e.target.value)}
            placeholder="twoj@email.pl"
            aria-label="Adres e-mail do wysyłki testowej"
          />
          <Button variant="outline" onClick={onSendTest} disabled={testPending} className="shrink-0">
            {testPending ? <Loader2 className="animate-spin" /> : <TestTube2 />}
            {testSentTo ? 'Wyślij ponownie' : 'Wyślij test'}
          </Button>
        </div>
      </section>

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
        <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
        <p>
          <strong>Wyślij kampanię</strong> rozpocznie wysyłkę do wszystkich aktywnych odbiorców wybranej listy. Tej
          operacji nie da się cofnąć.
        </p>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { zodFormResolver } from '@/lib/zodForm';
import { ArrowLeft, ArrowRight, Check, Loader2, Mail, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

import {
  useGRCampaigns,
  useGRFromFields,
  useGetResponseSettings,
  useSendNewsletter,
  useSendTestNewsletter,
} from '@/hooks/useGetResponse';
import { useNewsletterDefaults } from '@/hooks/useNewsletterDefaults';
import { useSiteContent } from '@/hooks/useSiteContent';
import { DEFAULT_SITE_IDENTITY } from '@/lib/siteContent';
import { useNewsletterConsentCount } from '@/hooks/useContacts';
import { newsletterWebUrl, useSaveNewsletterIssue } from '@/hooks/useNewsletterIssues';
import { renderNewsletter, renderNewsletterPlain, type PreviewBlockKey } from '@/lib/newsletter/render';
import {
  DEFAULT_SECTIONS,
  DEFAULT_TEMPLATE,
  campaignNameFor,
  newsletterTemplateSchema,
  type NewsletterTemplate,
} from '@/lib/newsletter/types';

import { Builder } from './newsletter/Builder';
import { clearDraft, loadDraft, loadLayout, mergeTemplate, saveDraft, saveLayout } from './newsletter/draft';
import { PreviewPane } from './newsletter/PreviewPane';
import { SECTION_META, blockDomId, countErrors, pluralize } from './newsletter/sections';
import { SendStep } from './newsletter/SendStep';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Treść wydania do zduplikowania (newsletter_issues.template) - zastępuje szkic. */
  duplicateFrom?: unknown;
}

type Step = 'edit' | 'send';

const DRAFT_SAVE_DELAY_MS = 600;

const BLOCK_LABELS: Record<'header' | 'footer', string> = { header: 'Nagłówek', footer: 'Stopka' };

export function NewsletterEditorDialog({ open, onClose, duplicateFrom }: Props) {
  const { profile } = useAuth();
  const userId = profile?.id ?? null;
  const settingsQ = useGetResponseSettings();
  const defaultsQ = useNewsletterDefaults();
  const siteQ = useSiteContent();
  // Dane posła do nagłówka i klauzuli RODO (site_identity); przed wczytaniem / przy błędzie - neutralne.
  const identity = siteQ.data?.identity ?? DEFAULT_SITE_IDENTITY;
  const campaignsQ = useGRCampaigns(open);
  const fromFieldsQ = useGRFromFields(open);
  const consentCountQ = useNewsletterConsentCount();
  const sendMut = useSendNewsletter();
  const sendTestMut = useSendTestNewsletter();
  const saveIssueMut = useSaveNewsletterIssue();

  const [step, setStep] = useState<Step>('edit');
  const [active, setActive] = useState<PreviewBlockKey | null>(null);
  const [scrollPreview, setScrollPreview] = useState(false);
  const [selectedListId, setSelectedListId] = useState('');
  const [selectedFromFieldId, setSelectedFromFieldId] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testSentTo, setTestSentTo] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const skipDraftFlushRef = useRef(false);
  /** Wydanie z wersją online tego newslettera (powstaje przy pierwszej wysyłce testowej / docelowej). */
  const issueIdRef = useRef<string | null>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);

  const defaultsReady = !defaultsQ.isLoading && !settingsQ.isLoading && !siteQ.isLoading;

  const defaultValues = useMemo<NewsletterTemplate>(() => {
    const nd = defaultsQ.data;
    return {
      ...DEFAULT_TEMPLATE,
      header: {
        ...DEFAULT_TEMPLATE.header,
        avatar_url: nd?.header_avatar_url || DEFAULT_TEMPLATE.header.avatar_url,
        region_label: nd?.region_label || DEFAULT_TEMPLATE.header.region_label,
      },
      footer: {
        ...DEFAULT_TEMPLATE.footer,
        office_name:
          nd?.footer_office_name ||
          (identity.mp_name_genitive ? `Biuro Poselskie ${identity.mp_name_genitive}` : DEFAULT_TEMPLATE.footer.office_name),
        office_address: nd?.footer_office_address || DEFAULT_TEMPLATE.footer.office_address,
        contact_email:
          nd?.footer_contact_email ||
          settingsQ.data?.from_email ||
          DEFAULT_TEMPLATE.footer.contact_email,
        privacy_url: nd?.footer_privacy_url || DEFAULT_TEMPLATE.footer.privacy_url,
        social_x: nd?.footer_social_x || DEFAULT_TEMPLATE.footer.social_x,
        social_facebook: nd?.footer_social_facebook || DEFAULT_TEMPLATE.footer.social_facebook,
        social_instagram: nd?.footer_social_instagram || DEFAULT_TEMPLATE.footer.social_instagram,
        social_tiktok: nd?.footer_social_tiktok || DEFAULT_TEMPLATE.footer.social_tiktok,
        social_youtube: nd?.footer_social_youtube || DEFAULT_TEMPLATE.footer.social_youtube,
      },
    };
  }, [defaultsQ.data, settingsQ.data?.from_email, identity.mp_name_genitive]);

  const form = useForm<NewsletterTemplate>({
    resolver: zodFormResolver(newsletterTemplateSchema),
    defaultValues,
    mode: 'onBlur',
  });

  /** Świeży newsletter: stałe z ustawień + układ sekcji z ostatniej wysyłki. */
  const freshValues = useCallback(
    (): NewsletterTemplate => ({ ...defaultValues, sections: (userId && loadLayout(userId)) || DEFAULT_SECTIONS }),
    [defaultValues, userId],
  );

  // Inicjalizacja raz na otwarcie, dopiero gdy stałe newslettera są wczytane -
  // późniejsze odświeżenie zapytań nie nadpisuje tego, co użytkownik już wpisał.
  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current || !defaultsReady) return;
    initializedRef.current = true;
    skipDraftFlushRef.current = false;

    const fresh = freshValues();
    if (duplicateFrom !== undefined && duplicateFrom !== null) {
      // Kopia wydania: treść jak w oryginale, ale dzisiejsza data, nowa nazwa kampanii i nowy link online.
      const copy = mergeTemplate(fresh, duplicateFrom);
      const values = { ...copy, campaign_name: '', header: { ...copy.header, date_label: fresh.header.date_label } };
      form.reset(values);
      issueIdRef.current = null;
      setRestoredAt(null);
      setSavedAt(userId ? saveDraft(userId, values, null) : null);
      setActive(values.sections[0] ?? null);
    } else {
      const draft = userId ? loadDraft(userId, fresh) : null;
      form.reset(draft?.values ?? fresh);
      issueIdRef.current = draft?.issueId ?? null;
      setRestoredAt(draft?.savedAt ?? null);
      setSavedAt(draft?.savedAt ?? null);
      setActive(draft ? null : (fresh.sections[0] ?? null));
    }
    setScrollPreview(false);
    setStep('edit');
    setTestSentTo(null);
    setSelectedListId(settingsQ.data?.default_list_id ?? '');
    setSelectedFromFieldId(settingsQ.data?.from_field_id ?? '');
    setTestEmail(profile?.email ?? '');
  }, [open, defaultsReady, freshValues, duplicateFrom, userId, form, settingsQ.data?.default_list_id, settingsQ.data?.from_field_id, profile?.email]);

  // Autozapis szkicu (debounce) - zmiany od użytkownika, nie reset formularza.
  useEffect(() => {
    if (!open || !userId) return;
    let timer: number | undefined;
    const flush = () => {
      timer = undefined;
      setSavedAt(saveDraft(userId, form.getValues(), issueIdRef.current));
    };
    const sub = form.watch((_values, { name }) => {
      if (!name || !initializedRef.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, DRAFT_SAVE_DELAY_MS);
    });
    return () => {
      sub.unsubscribe();
      if (timer !== undefined) {
        window.clearTimeout(timer);
        if (!skipDraftFlushRef.current) flush();
      }
    };
  }, [open, userId, form]);

  const scrollEditorTo = (id: string) =>
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));

  /** Wybór bloku z podglądu / checklisty / palety: otwórz go w edytorze i pokaż w podglądzie. */
  const selectBlock = (key: PreviewBlockKey, fromPreview = false) => {
    setStep('edit');
    setActive(key);
    setScrollPreview(!fromPreview);
    scrollEditorTo(blockDomId(key));
  };

  const toggleBlock = (key: PreviewBlockKey) => {
    setActive((prev) => (prev === key ? null : key));
    setScrollPreview(true);
  };

  const discardDraft = () => {
    if (userId) clearDraft(userId);
    issueIdRef.current = null;
    const fresh = freshValues();
    form.reset(fresh);
    setRestoredAt(null);
    setSavedAt(null);
    setActive(fresh.sections[0] ?? null);
  };

  const handleInvalid = (errors: FieldErrors<NewsletterTemplate>) => {
    const values = form.getValues();
    const order: PreviewBlockKey[] = ['header', ...values.sections, 'footer'];
    const broken = order.filter((key) => countErrors(errors[key]) > 0);
    const basicsBroken = countErrors(errors.subject) + countErrors(errors.preheader) + countErrors(errors.campaign_name) > 0;

    const labels = [
      ...(basicsBroken ? ['Temat i zajawka'] : []),
      ...broken.map((key) => (key === 'header' || key === 'footer' ? BLOCK_LABELS[key] : SECTION_META[key].label)),
      ...(errors.sections ? ['Układ maila'] : []),
    ];
    toast.error('Uzupełnij brakujące pola', { description: labels.join(', ') });

    if (basicsBroken) {
      scrollEditorTo(blockDomId('basics'));
    } else if (broken[0]) {
      selectBlock(broken[0]);
    }
  };

  const goToSend = form.handleSubmit(() => {
    setStep('send');
    editorScrollRef.current?.scrollTo({ top: 0 });
  }, handleInvalid);

  const resolveTargets = () => ({
    listId: selectedListId || settingsQ.data?.default_list_id || '',
    fromFieldId: selectedFromFieldId || settingsQ.data?.from_field_id || '',
  });

  const requireTargets = () => {
    // Nagłówek i klauzula RODO muszą wskazywać posła - bez danych z bazy kampania nie wychodzi do listy.
    if (!siteQ.data?.identity.mp_name) {
      toast.error('Brak danych posła', {
        description: siteQ.isError
          ? 'Nie udało się wczytać danych posła. Odśwież stronę i spróbuj ponownie.'
          : 'Uzupełnij imię i nazwisko posła w Administracja → Strona główna.',
      });
      return null;
    }
    const targets = resolveTargets();
    if (!targets.listId) {
      toast.error('Wybierz listę odbiorców');
      return null;
    }
    if (!targets.fromFieldId) {
      toast.error('Wybierz adres nadawcy');
      return null;
    }
    return targets;
  };

  /**
   * Zapisuje wydanie (wersja online pod /n/<slug>) i zwraca treść maila z linkiem do niej.
   * Kolejne testy nadpisują ten sam szkic wydania (ten sam slug). /n/<slug> serwuje tylko wydania
   * wysłane, więc link z maila testowego zacznie działać dopiero po wysyłce kampanii.
   */
  const prepareMail = async (values: NewsletterTemplate) => {
    let issue;
    try {
      issue = await saveIssueMut.mutateAsync({
        id: issueIdRef.current,
        subject: values.subject,
        template: values,
        html_web: renderNewsletter(values, { mode: 'web', identity }),
      });
    } catch (err) {
      throw new Error(`Nie udało się zapisać wersji online: ${err instanceof Error ? err.message : 'nieznany błąd'}`);
    }
    issueIdRef.current = issue.id;
    if (userId) setSavedAt(saveDraft(userId, values, issue.id));
    const webUrl = newsletterWebUrl(issue.slug);
    return { issueId: issue.id, html: renderNewsletter(values, { webUrl, identity }), plain: renderNewsletterPlain(values, webUrl) };
  };

  const handleSend = async () => {
    const targets = requireTargets();
    if (!targets) return;
    const values = form.getValues();
    try {
      const mail = await prepareMail(values);
      // Proxy po sukcesie w GetResponse sam oznacza wydanie jako wysłane (status/sent_at zmienia tylko serwer).
      const result = await sendMut.mutateAsync({
        name: campaignNameFor(values),
        subject: values.subject,
        html: mail.html,
        plain: mail.plain,
        list_id: targets.listId,
        from_field_id: targets.fromFieldId,
        issue_id: mail.issueId,
      });
      if (result.issue_marked === false) {
        toast.warning('Newsletter wysłany, ale nie trafił do archiwum wydań');
      }
      if (userId) {
        skipDraftFlushRef.current = true;
        clearDraft(userId);
        saveLayout(userId, values.sections);
      }
      toast.success('Kampania wysłana do GetResponse', {
        description: 'Sprawdź status w liście kampanii.',
      });
      setConfirmOpen(false);
      onClose();
    } catch (err) {
      toast.error('Wysyłka nie powiodła się', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const handleSendTest = async () => {
    const email = testEmail.trim();
    if (!email) {
      toast.error('Podaj adres e-mail testowy');
      return;
    }
    const targets = requireTargets();
    if (!targets) return;
    const values = form.getValues();
    try {
      const mail = await prepareMail(values);
      await sendTestMut.mutateAsync({
        test_email: email,
        name: campaignNameFor(values),
        subject: values.subject,
        html: mail.html,
        plain: mail.plain,
        list_id: targets.listId,
        from_field_id: targets.fromFieldId,
      });
      setTestSentTo(email);
      toast.success('Mail testowy wysłany', { description: `Sprawdź skrzynkę: ${email}` });
    } catch (err) {
      toast.error('Wysyłka testowa nie powiodła się', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const { listId, fromFieldId } = resolveTargets();
  const listName = campaignsQ.data?.find((c) => c.campaignId === listId)?.name;
  const senderName =
    fromFieldsQ.data?.find((f) => f.fromFieldId === fromFieldId)?.name || form.getValues('footer.office_name') || '';
  const consentCount = consentCountQ.data ?? null;
  // Zapis wersji online poprzedza każdą wysyłkę - blokujemy przyciski także na ten czas.
  const sending = sendMut.isPending || (saveIssueMut.isPending && confirmOpen);
  const testing = sendTestMut.isPending || (saveIssueMut.isPending && !confirmOpen);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex h-[95vh] max-h-[95vh] max-w-[95vw] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[1440px]"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b px-5 py-3 pr-12 text-left">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Mail className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <DialogTitle>Nowy newsletter</DialogTitle>
            <DialogDescription className="flex items-center gap-1.5">
              {savedAt ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  Szkic zapisany {new Date(savedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} —
                  możesz zamknąć i wrócić później
                </>
              ) : (
                'Dodaj sekcje i uzupełnij treść. Szkic zapisuje się automatycznie.'
              )}
            </DialogDescription>
          </div>
          <ol className="hidden items-center gap-1 text-xs sm:flex" aria-label="Kroki">
            {(
              [
                ['edit', '1', 'Treść'],
                ['send', '2', 'Wysyłka'],
              ] as const
            ).map(([key, num, label]) => (
              <li
                key={key}
                aria-current={step === key ? 'step' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium',
                  step === key ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full text-[10px]',
                    step === key ? 'bg-primary text-primary-foreground' : 'bg-muted',
                  )}
                >
                  {num}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <div ref={editorScrollRef} className="w-full overflow-y-auto bg-muted/20 lg:w-[46%] lg:border-r">
            {!defaultsReady ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Wczytuję ustawienia newslettera…
              </div>
            ) : step === 'edit' ? (
              <Builder
                form={form}
                active={active}
                onToggle={toggleBlock}
                onSelect={(key) => selectBlock(key)}
                restoredAt={restoredAt}
                onDiscardDraft={discardDraft}
              />
            ) : (
              <SendStep
                values={form.getValues()}
                onFix={(key) => selectBlock(key)}
                selectedListId={selectedListId}
                onListChange={setSelectedListId}
                selectedFromFieldId={selectedFromFieldId}
                onFromFieldChange={setSelectedFromFieldId}
                campaigns={campaignsQ.data ?? []}
                campaignsLoading={campaignsQ.isLoading}
                fromFields={fromFieldsQ.data ?? []}
                fromFieldsLoading={fromFieldsQ.isLoading}
                campaignName={campaignNameFor(form.getValues())}
                consentCount={consentCount}
                testEmail={testEmail}
                onTestEmailChange={setTestEmail}
                onSendTest={handleSendTest}
                testPending={testing}
                testSentTo={testSentTo}
              />
            )}
          </div>

          <div className="hidden min-w-0 flex-1 lg:flex">
            {defaultsReady && (
              <PreviewPane
                control={form.control}
                active={active}
                scrollToActive={scrollPreview}
                onSelect={(key) => selectBlock(key, true)}
                senderName={senderName}
                identity={identity}
              />
            )}
          </div>
        </div>

        <DialogFooter className="static bottom-auto !mb-0 border-t bg-muted/30 px-5 py-3 pb-3 sm:justify-between max-md:!mb-0">
          <div className="flex items-center gap-2">
            {step === 'send' && (
              <Button variant="ghost" onClick={() => setStep('edit')}>
                <ArrowLeft /> Wróć do treści
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Zamknij
            </Button>
            {step === 'edit' ? (
              <Button onClick={goToSend} disabled={!defaultsReady}>
                Dalej: wysyłka <ArrowRight />
              </Button>
            ) : (
              <Button variant="brand" onClick={() => requireTargets() && setConfirmOpen(true)} disabled={sending || testing}>
                <Send />
                Wyślij kampanię
              </Button>
            )}
          </div>
        </DialogFooter>

        <AlertDialog open={confirmOpen} onOpenChange={(o) => !sending && setConfirmOpen(o)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Wysłać newsletter teraz?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    <span className="font-medium text-foreground">„{form.getValues('subject')}”</span> trafi do listy{' '}
                    <span className="font-medium text-foreground">{listName ?? 'wybranej w GetResponse'}</span>
                    {consentCount !== null && (
                      <> (w ePośle {pluralize(consentCount, 'kontakt', 'kontakty', 'kontaktów')} ze zgodą)</>
                    )}
                    .
                  </p>
                  {!testSentTo && <p>Nie wysłano maila testowego w tej sesji.</p>}
                  <p>Wysyłki nie da się cofnąć.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={sending}>Anuluj</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void handleSend();
                }}
                disabled={sending}
              >
                {sending ? <Loader2 className="animate-spin" /> : <Send />}
                Wyślij teraz
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

// Treść powiadomień: e-mail (HTML + tekst) i push. Jedna struktura bloków renderowana do obu
// formatów. Push nie zawiera tytułów spraw ani innych danych (ekran blokady); e-mail zawiera
// tytuły tylko przy `include_titles`.
// Dzwonek w aplikacji renderuje te same rodzaje po stronie klienta (src/lib/notificationInbox.ts,
// renderInboxItem; mapy SERVICE_* i MODULE_* powielone) - nowy rodzaj albo zmiana linku: oba pliki.

import { z } from 'zod';
import type { MpForms } from '../siteIdentity.js';
import type { PushMessage } from './push.js';
import { instanceFlags } from '../instance.js';

export interface RenderContext {
  officeName: string;
  appUrl: string;
  includeTitles: boolean;
  mp: MpForms;
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
  push: PushMessage;
}

type Block =
  | { type: 'p'; text: string }
  | { type: 'facts'; rows: [string, string][] }
  | { type: 'section'; title: string; items: { text: string; meta?: string; path?: string }[]; more?: string }
  | { type: 'note'; text: string };

interface Message {
  subject: string;
  heading: string;
  blocks: Block[];
  cta?: { label: string; path: string };
  push: { title: string; body: string; path: string };
}

// ---------------------------------------------------------------------------
// Payloady (z bazy - walidowane łagodnie, złe pole = brak pola)
// ---------------------------------------------------------------------------

const optStr = z.string().nullish().catch(null);
const optNum = z.number().nullish().catch(null);

const IntegrationPayload = z.object({ service: optStr, name: optStr, at: optStr }).loose();
const ChangeValue = z.object({ from: z.unknown(), to: z.unknown() }).loose();
const AccountPayload = z
  .object({ event: optStr, actor: optStr, at: optStr, changes: z.record(z.string(), ChangeValue).catch({}).optional() })
  .loose();
const CasePayload = z.object({ case_id: optStr, title: optStr, due_date: optStr, actor: optStr, count: optNum }).loose();
const CaseCommentPayload = z
  .object({ case_id: optStr, case_title: optStr, actor_name: optStr, excerpt: optStr, comment_id: optStr })
  .loose();
const EventPayload = z.object({ event_id: optStr, title: optStr, starts_at: optStr, all_day: z.boolean().catch(false).optional(), actor: optStr }).loose();
const InterpellationPayload = z
  .object({ interpellation_id: optStr, subject: optStr, status: optStr, revision: optNum, actor: optStr, review_notes: optStr })
  .loose();
const ResponsibilityPayload = z.object({ module: optStr, actor: optStr }).loose();
const optTitles = z.array(z.string()).catch([]).optional();
const SigningRequestPayload = z
  .object({ count: optNum, titles: optTitles, actor_name: optStr, document_id: optStr, revised: z.boolean().catch(false).optional(), note: optStr })
  .loose();
const SigningDecisionPayload = z
  .object({ decision: optStr, count: optNum, titles: optTitles, actor_name: optStr, document_id: optStr, notes: optStr })
  .loose();
const DigestCase = z.object({ id: z.string(), title: z.string().catch(''), due_date: z.string().catch(''), days_overdue: optNum }).loose();
const DigestEvent = z
  .object({ id: z.string(), title: z.string().catch(''), starts_at: z.string().catch(''), all_day: z.boolean().catch(false), location: optStr })
  .loose();
const DigestPayload = z
  .object({
    period: z.enum(['day', 'week']).catch('week'),
    today: z.string().catch(''),
    horizon: z.string().catch(''),
    overdue_count: z.number().catch(0),
    overdue_cases: z.array(DigestCase).catch([]),
    due_count: z.number().catch(0),
    due_cases: z.array(DigestCase).catch([]),
    events_count: z.number().catch(0),
    events: z.array(DigestEvent).catch([]),
    office: z
      .object({
        overdue_count: z.number().catch(0),
        unassigned_count: z.number().catch(0),
        public_new_count: z.number().catch(0),
        interpellations_pending: z.number().catch(0),
      })
      .nullish()
      .catch(null),
    interpellations: z.object({ remarks: z.number().catch(0), send_overdue: z.number().catch(0) }).nullish().catch(null),
    budget: z
      .object({ month: z.string().catch(''), spent: z.number().catch(0), limit: z.number().catch(0), missing_invoices: z.number().catch(0) })
      .nullish()
      .catch(null),
  })
  .loose();

// ---------------------------------------------------------------------------
// Formatowanie
// ---------------------------------------------------------------------------

const MODULE_LABELS: Record<string, string> = {
  kalendarz: 'Kalendarz',
  teren: 'Widoczność w terenie',
  interpelacje: 'Interpelacje',
  budzet: 'Budżet biura',
  newsletter: 'Newsletter',
};

const MODULE_PATHS: Record<string, string> = {
  kalendarz: '/biuro/kalendarz',
  teren: '/biuro/teren',
  interpelacje: '/biuro/interpelacje',
  budzet: '/biuro/budzet',
};

const SCOPE_FIELDS: Record<string, string> = {
  scope_contacts: 'Kontakty',
  scope_cases: 'Sprawy',
  scope_events: 'Kalendarz',
  scope_interpellations: 'Interpelacje',
};

function moduleLabel(key: string | null | undefined): string {
  return (key && MODULE_LABELS[key]) || key || 'obszar';
}

function roleLabel(role: unknown, mp: MpForms): string {
  switch (role) {
    case 'posel':
      return mp.nominative;
    case 'administrator':
      return 'Administrator';
    case 'pracownik':
      return 'Pracownik';
    case 'asystent':
      return 'Asystent';
    default:
      return typeof role === 'string' ? role : '-';
  }
}

function scopeLabel(value: unknown): string {
  return value === 'own' ? 'tylko własne' : value === 'all' ? 'wszystkie' : '-';
}

const DATE_FMT = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'long', year: 'numeric' });
const DAY_FMT = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', weekday: 'short', day: 'numeric', month: 'short' });
const TIME_FMT = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
const DATETIME_FMT = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** 'YYYY-MM-DD' jako data kalendarzowa (bez przesunięcia strefy). */
function parseDay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)) : null;
}

function formatDay(value: string | null | undefined): string {
  const d = value ? parseDay(value) : null;
  return d ? DATE_FMT.format(d) : '';
}

function formatInstant(value: string | null | undefined, fmt: Intl.DateTimeFormat): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : fmt.format(d);
}

function formatEventTime(startsAt: string, allDay: boolean): string {
  if (allDay) return `${formatInstant(startsAt, DAY_FMT)}, cały dzień`;
  return `${formatInstant(startsAt, DAY_FMT)}, ${formatInstant(startsAt, TIME_FMT)}`;
}

function money(value: number): string {
  return `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(value)} zł`;
}

/** Polska odmiana liczebnika: 1 sprawa, 2 sprawy, 5 spraw. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

function quoted(title: string | null | undefined): string {
  const t = (title ?? '').trim();
  return t ? `„${t}”` : '';
}

// ---------------------------------------------------------------------------
// Wiadomości
// ---------------------------------------------------------------------------

const SERVICE_LABELS: Record<string, string> = {
  mcp: 'token MCP',
  oauth: 'aplikacja OAuth',
  ics: 'kalendarz ICS',
};

const SERVICE_PATHS: Record<string, string> = {
  mcp: '/biuro/admin/integracje/mcp',
  oauth: '/biuro/admin/integracje/mcp',
  ics: '/biuro/admin/integracje',
};

function integrationMessage(raw: unknown): Message {
  const p = IntegrationPayload.parse(raw ?? {});
  const service = p.service ?? '';
  const label = SERVICE_LABELS[service] ?? 'nowa usługa';
  const name = quoted(p.name);
  const when = formatInstant(p.at, DATETIME_FMT);
  return {
    subject: 'Do Twojego konta podłączono nową usługę',
    heading: 'Nowa usługa podłączona do konta',
    blocks: [
      { type: 'p', text: `Do Twojego konta w portalu biura podłączono: ${label}${name ? ` ${name}` : ''}${when ? ` (${when})` : ''}.` },
      {
        type: 'note',
        text: 'Jeśli to nie Ty, od razu unieważnij dostęp w Integracjach i powiadom administratora biura.',
      },
    ],
    // Strona MCP istnieje tylko przy INSTANCE_MCP=on - inaczej hub Integracji (jak src/lib/notificationInbox.ts).
    cta: { label: 'Sprawdź integracje', path: (instanceFlags().mcp ? SERVICE_PATHS[service] : undefined) ?? '/biuro/admin/integracje' },
    push: { title: 'Nowa usługa podłączona do konta', body: `${label[0].toUpperCase()}${label.slice(1)}. Jeśli to nie Ty, sprawdź Integracje.`, path: '/biuro/admin/integracje' },
  };
}

function accountMessage(raw: unknown, ctx: RenderContext): Message {
  const p = AccountPayload.parse(raw ?? {});
  const by = p.actor ? `Operację wykonał(a): ${p.actor}.` : '';
  switch (p.event) {
    case 'sessions_revoked':
      return {
        subject: 'Wylogowano Cię ze wszystkich urządzeń',
        heading: 'Wylogowano Cię ze wszystkich urządzeń',
        blocks: [
          { type: 'p', text: `Administrator biura zakończył wszystkie Twoje sesje i usunął ustawienia 2FA. ${by}`.trim() },
          { type: 'p', text: 'Przy następnym logowaniu ustawisz uwierzytelnianie dwuskładnikowe od nowa.' },
          { type: 'note', text: 'Jeśli nie wiesz, dlaczego tak się stało, skontaktuj się z administratorem biura.' },
        ],
        cta: { label: 'Zaloguj się', path: '/login' },
        push: { title: 'Wylogowano Cię ze wszystkich urządzeń', body: 'Zaloguj się ponownie i ustaw 2FA.', path: '/login' },
      };
    case 'mfa_reset':
      return {
        subject: 'Zresetowano Twoje uwierzytelnianie dwuskładnikowe (2FA)',
        heading: 'Zresetowano 2FA',
        blocks: [
          { type: 'p', text: `Administrator biura usunął Twoje ustawienia 2FA. ${by}`.trim() },
          { type: 'p', text: 'Przy następnym logowaniu skonfigurujesz aplikację uwierzytelniającą ponownie.' },
          { type: 'note', text: 'Jeśli nie prosiłeś(-aś) o reset, skontaktuj się z administratorem biura.' },
        ],
        cta: { label: 'Otwórz portal', path: '/biuro/profil' },
        push: { title: 'Zresetowano 2FA', body: 'Przy następnym logowaniu ustawisz 2FA ponownie.', path: '/biuro/profil' },
      };
    default: {
      const rows: [string, string][] = [];
      for (const [field, change] of Object.entries(p.changes ?? {})) {
        if (field === 'role') rows.push(['Rola', `${roleLabel(change.from, ctx.mp)} → ${roleLabel(change.to, ctx.mp)}`]);
        else if (SCOPE_FIELDS[field]) rows.push([`Zakres: ${SCOPE_FIELDS[field]}`, `${scopeLabel(change.from)} → ${scopeLabel(change.to)}`]);
      }
      return {
        subject: 'Zmieniono Twoje uprawnienia w portalu biura',
        heading: 'Zmieniono Twoje uprawnienia',
        blocks: [
          { type: 'p', text: `Zmieniono rolę albo zakres dostępu do danych na Twoim koncie. ${by}`.trim() },
          ...(rows.length ? [{ type: 'facts' as const, rows }] : []),
        ],
        cta: { label: 'Otwórz portal', path: '/biuro' },
        push: { title: 'Zmieniono Twoje uprawnienia', body: 'Szczegóły w wiadomości e-mail i w portalu.', path: '/biuro' },
      };
    }
  }
}

/** Ile znaków tytułu z formularza publicznego trafia do treści e-maila (N3-01). */
const PUBLIC_TITLE_MAX = 80;

function caseMessage(kind: 'case_assigned' | 'case_deadline' | 'public_submission', raw: unknown, ctx: RenderContext): Message {
  const p = CasePayload.parse(raw ?? {});
  const title = ctx.includeTitles ? quoted(p.title) : '';
  const path = p.case_id ? `/biuro/sprawy?open=${encodeURIComponent(p.case_id)}` : '/biuro/sprawy';
  const due = formatDay(p.due_date);
  if (kind === 'case_assigned') {
    return {
      subject: title ? `Przypisano Ci sprawę: ${title}` : 'Przypisano Ci nową sprawę',
      heading: 'Przypisano Ci sprawę',
      blocks: [
        { type: 'p', text: title ? `Sprawa ${title} jest teraz przypisana do Ciebie.` : 'Nowa sprawa wyborcy jest teraz przypisana do Ciebie.' },
        {
          type: 'facts',
          rows: [
            ...(p.actor ? [['Przypisał(a)', p.actor] as [string, string]] : []),
            ...(due ? [['Termin', due] as [string, string]] : []),
          ],
        },
      ],
      cta: { label: 'Otwórz sprawę', path },
      push: { title: 'Przypisano Ci sprawę', body: due ? `Termin: ${due}.` : 'Otwórz, aby zobaczyć szczegóły.', path },
    };
  }
  if (kind === 'case_deadline') {
    return {
      subject: title ? `Jutro mija termin sprawy: ${title}` : 'Jutro mija termin Twojej sprawy',
      heading: 'Jutro mija termin sprawy',
      blocks: [
        { type: 'p', text: title ? `Termin sprawy ${title} mija jutro${due ? ` (${due})` : ''}.` : `Termin jednej z Twoich spraw mija jutro${due ? ` (${due})` : ''}.` },
        { type: 'p', text: 'Zamknij sprawę albo zaktualizuj termin, jeśli wymaga więcej czasu.' },
      ],
      cta: { label: 'Otwórz sprawę', path },
      push: { title: 'Jutro mija termin sprawy', body: 'Otwórz, aby zobaczyć szczegóły.', path },
    };
  }
  // Zgłoszenia grupowane w bazie (okna 15 min na odbiorcę): count > 1 = zbiorcze, bez jednej sprawy.
  const count = p.count && p.count > 1 ? Math.floor(p.count) : 1;
  if (count > 1) {
    const many = plural(count, 'nowe zgłoszenie', 'nowe zgłoszenia', 'nowych zgłoszeń');
    return {
      subject: `Formularz na stronie: ${many}`,
      heading: 'Nowe zgłoszenia z formularza',
      blocks: [
        { type: 'p', text: `Przez formularz na stronie przyszło w krótkim czasie ${many}.` },
        { type: 'p', text: 'Zgłoszenia czekają w Sprawach ze statusem „Nowa”. Kolejne z najbliższych minut przyjdą w jednym powiadomieniu zbiorczym.' },
      ],
      cta: { label: 'Otwórz Sprawy', path: '/biuro/sprawy' },
      push: { title: `Formularz na stronie: ${many}`, body: 'Zgłoszenia czekają w Sprawach.', path: '/biuro/sprawy' },
    };
  }
  // Tytuł pisze anonim z formularza (N3-01): nigdy w temacie wiadomości wysyłanej z adresu biura; w treści
  // tylko z etykietą, skrócony i z rozbrojonymi adresami (klient poczty nie zrobi z nich linku).
  const submitted = ctx.includeTitles ? oneLine(p.title ?? '', PUBLIC_TITLE_MAX).replace(/:\/\//g, '[:]//').replace(/\bwww\./gi, 'www[.]') : '';
  return {
    subject: 'Nowe zgłoszenie z formularza na stronie',
    heading: 'Nowe zgłoszenie z formularza',
    blocks: [
      { type: 'p', text: 'Wyborca wysłał zgłoszenie przez formularz na stronie.' },
      ...(submitted ? [{ type: 'note' as const, text: `Tytuł podany przez zgłaszającego: „${submitted}”` }] : []),
      { type: 'p', text: 'Zgłoszenie czeka w Sprawach ze statusem „Nowa”.' },
    ],
    cta: { label: 'Otwórz zgłoszenie', path },
    push: { title: 'Nowe zgłoszenie z formularza', body: 'Zgłoszenie czeka w Sprawach.', path },
  };
}

// Komentarze w sprawie: wzmianka @ (case_mention) i nowy komentarz w mojej sprawie (case_comment).
// Tytuł sprawy i fragment komentarza tylko w e-mailu przy include_titles; push bez treści.
function caseCommentMessage(kind: 'case_mention' | 'case_comment', raw: unknown, ctx: RenderContext): Message {
  const p = CaseCommentPayload.parse(raw ?? {});
  const title = ctx.includeTitles ? quoted(p.case_title) : '';
  const excerpt = ctx.includeTitles ? (p.excerpt ?? '').trim() : '';
  const path = p.case_id ? `/biuro/sprawy?open=${encodeURIComponent(p.case_id)}` : '/biuro/sprawy';
  const actor = (p.actor_name ?? '').trim();
  const mention = kind === 'case_mention';
  const heading = mention ? 'Wspomniano o Tobie w sprawie' : 'Nowy komentarz w sprawie';
  const text = mention
    ? `${actor ? `${actor} wspomniał(a)` : 'Ktoś wspomniał'} o Tobie w komentarzu do sprawy${title ? ` ${title}` : ''}.`
    : `${actor ? `${actor} dodał(a)` : 'Dodano'} komentarz do sprawy${title ? ` ${title}` : ''}, którą prowadzisz albo utworzyłeś(-aś).`;
  return {
    subject: title ? `${heading}: ${title}` : heading,
    heading,
    blocks: [{ type: 'p', text }, ...(excerpt ? [{ type: 'note' as const, text: `„${excerpt}”` }] : [])],
    cta: { label: mention ? 'Odpowiedz w sprawie' : 'Otwórz sprawę', path },
    push: { title: heading, body: 'Otwórz, aby przeczytać komentarz.', path },
  };
}

function eventMessage(raw: unknown, ctx: RenderContext): Message {
  const p = EventPayload.parse(raw ?? {});
  const title = ctx.includeTitles ? quoted(p.title) : '';
  const path = p.event_id ? `/biuro/kalendarz?open=${encodeURIComponent(p.event_id)}` : '/biuro/kalendarz';
  const when = p.starts_at ? formatEventTime(p.starts_at, p.all_day === true) : '';
  return {
    subject: title ? `Przypisano Ci wydarzenie: ${title}` : 'Przypisano Ci wydarzenie w kalendarzu',
    heading: 'Przypisano Ci wydarzenie',
    blocks: [
      { type: 'p', text: title ? `Wydarzenie ${title} jest teraz przypisane do Ciebie.` : 'Wydarzenie w kalendarzu jest teraz przypisane do Ciebie.' },
      {
        type: 'facts',
        rows: [
          ...(when ? [['Kiedy', when] as [string, string]] : []),
          ...(p.actor ? [['Przypisał(a)', p.actor] as [string, string]] : []),
        ],
      },
    ],
    cta: { label: 'Otwórz wydarzenie', path },
    push: { title: 'Przypisano Ci wydarzenie', body: when || 'Otwórz, aby zobaczyć szczegóły.', path },
  };
}

function interpellationMessage(kind: 'interpellation_review' | 'interpellation_decision', raw: unknown, ctx: RenderContext): Message {
  const p = InterpellationPayload.parse(raw ?? {});
  const title = ctx.includeTitles ? quoted(p.subject) : '';
  const path = p.interpellation_id ? `/biuro/interpelacje/${encodeURIComponent(p.interpellation_id)}` : '/biuro/interpelacje';
  if (kind === 'interpellation_review') {
    const revised = p.status === 'po_poprawkach';
    const heading = revised ? 'Poprawiona interpelacja czeka na decyzję' : 'Nowa interpelacja czeka na decyzję';
    return {
      subject: title ? `${heading}: ${title}` : heading,
      heading,
      blocks: [
        {
          type: 'p',
          text: revised
            ? `Interpelacja${title ? ` ${title}` : ''} została poprawiona${p.revision ? ` (wersja ${p.revision})` : ''} i czeka na Twoją decyzję.`
            : `Interpelacja${title ? ` ${title}` : ''} czeka na Twoją decyzję: akceptację, uwagi albo odrzucenie.`,
        },
      ],
      cta: { label: 'Otwórz interpelację', path },
      push: { title: heading, body: 'Otwórz, aby podjąć decyzję.', path },
    };
  }
  const notes = ctx.includeTitles ? (p.review_notes ?? '').trim() : '';
  const by = p.actor ? ` Decyzję podjął(-ęła): ${p.actor}.` : '';
  const variants: Record<string, { heading: string; text: string }> = {
    zaakceptowana: { heading: 'Interpelacja zaakceptowana', text: `Interpelacja${title ? ` ${title}` : ''} została zaakceptowana. Wyślij ją w ciągu doby.${by}` },
    uwagi: { heading: 'Uwagi do interpelacji', text: `Do interpelacji${title ? ` ${title}` : ''} zgłoszono uwagi. Popraw ją i prześlij ponownie.${by}` },
    odrzucona: { heading: 'Interpelacja odrzucona', text: `Interpelacja${title ? ` ${title}` : ''} została odrzucona.${by}` },
  };
  const v = variants[p.status ?? ''] ?? { heading: 'Decyzja w sprawie interpelacji', text: `Zapadła decyzja w sprawie interpelacji${title ? ` ${title}` : ''}.${by}` };
  return {
    subject: title ? `${v.heading}: ${title}` : v.heading,
    heading: v.heading,
    blocks: [{ type: 'p', text: v.text }, ...(notes ? [{ type: 'note' as const, text: `Uwagi: ${notes}` }] : [])],
    cta: { label: 'Otwórz interpelację', path },
    push: { title: v.heading, body: 'Otwórz, aby zobaczyć szczegóły.', path },
  };
}

function responsibilityMessage(raw: unknown): Message {
  const p = ResponsibilityPayload.parse(raw ?? {});
  const label = moduleLabel(p.module);
  const path = (p.module && MODULE_PATHS[p.module]) || '/biuro';
  return {
    subject: `Zostajesz opiekunem obszaru: ${label}`,
    heading: `Zostajesz opiekunem obszaru: ${label}`,
    blocks: [
      { type: 'p', text: `${p.actor ? `${p.actor} przypisał(a)` : 'Przypisano'} Ci obszar „${label}”. Aktywność w tym obszarze pokazuje Puls Biura.` },
    ],
    cta: { label: 'Przejdź do obszaru', path },
    push: { title: `Zostajesz opiekunem obszaru: ${label}`, body: 'Otwórz portal, aby zobaczyć szczegóły.', path },
  };
}

// Dokumenty do podpisu: jedno powiadomienie na operację (count + do 5 tytułów). Link do dokumentu
// tylko przy jednym dokumencie, inaczej do listy.
function signingPath(count: number, documentId: string | null | undefined): string {
  return count === 1 && documentId ? `/biuro/dokumenty/${encodeURIComponent(documentId)}` : '/biuro/dokumenty';
}

function signingTitlesSection(titles: string[] | undefined, count: number, ctx: RenderContext): Block[] {
  if (!ctx.includeTitles || count < 2) return [];
  const shown = (titles ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 5);
  if (!shown.length) return [];
  return [
    {
      type: 'section',
      title: 'Dokumenty',
      items: shown.map((text) => ({ text })),
      more: count > shown.length ? `i ${count - shown.length} więcej w module Dokumenty do podpisu` : undefined,
    },
  ];
}

function signingRequestMessage(raw: unknown, ctx: RenderContext): Message {
  const p = SigningRequestPayload.parse(raw ?? {});
  const count = p.count && p.count > 1 ? Math.floor(p.count) : 1;
  const path = signingPath(count, p.document_id);
  const title = count === 1 && ctx.includeTitles ? quoted(p.titles?.[0]) : '';
  const note = ctx.includeTitles ? (p.note ?? '').trim() : '';
  const many = plural(count, 'dokument', 'dokumenty', 'dokumentów');
  let heading: string;
  let text: string;
  if (p.revised) {
    heading = 'Poprawiony dokument czeka na podpis';
    text = `${p.actor_name ? `${p.actor_name} wgrał(a)` : 'Biuro wgrało'} nową wersję dokumentu${title ? ` ${title}` : ''}. Dokument czeka na Twój podpis.`;
  } else if (count > 1) {
    heading = `Dokumenty do podpisu: ${count}`;
    text = `${p.actor_name ? `${p.actor_name} przekazał(a)` : 'Biuro przekazało'} do podpisu ${many}. Pobierz je w paczce ZIP, podpisz i wgraj podpisane pliki.`;
  } else {
    heading = 'Dokument czeka na podpis';
    text = `${p.actor_name ? `${p.actor_name} przekazał(a)` : 'Biuro przekazało'} do podpisu dokument${title ? ` ${title}` : ''}.`;
  }
  return {
    subject: title ? `${heading}: ${title}` : heading,
    heading,
    blocks: [
      { type: 'p', text },
      ...signingTitlesSection(p.titles, count, ctx),
      ...(note ? [{ type: 'note' as const, text: `Notatka: ${note}` }] : []),
    ],
    cta: { label: count > 1 ? 'Otwórz dokumenty do podpisu' : 'Otwórz dokument', path },
    push: { title: heading, body: count > 1 ? 'Otwórz, aby pobrać paczkę do podpisu.' : 'Otwórz, aby zobaczyć dokument.', path },
  };
}

function signingDecisionMessage(raw: unknown, ctx: RenderContext): Message {
  const p = SigningDecisionPayload.parse(raw ?? {});
  const count = p.count && p.count > 1 ? Math.floor(p.count) : 1;
  const path = signingPath(count, p.document_id);
  const title = count === 1 && ctx.includeTitles ? quoted(p.titles?.[0]) : '';
  const notes = ctx.includeTitles ? (p.notes ?? '').trim() : '';
  const many = plural(count, 'dokument', 'dokumenty', 'dokumentów');
  const one = `dokument${title ? ` ${title}` : ''}`;
  const actor = p.actor_name || ctx.mp.nominative;
  const variants: Record<string, { heading: string; text: string }> = {
    do_poprawy: {
      heading: count > 1 ? `Dokumenty do poprawy: ${count}` : 'Dokument do poprawy',
      text: `${actor} zwrócił(a) do poprawy ${count > 1 ? many : one}. Popraw ${count > 1 ? 'je' : 'go'} i wgraj nową wersję.`,
    },
    podpisany: {
      heading: count > 1 ? `Podpisane dokumenty: ${count}` : 'Dokument podpisany',
      text: `${actor} podpisał(a) ${count > 1 ? many : one}. ${count > 1 ? 'Są gotowe' : 'Jest gotowy'} do wysyłki.`,
    },
    wyslany: {
      heading: count > 1 ? `Wysłane dokumenty: ${count}` : 'Dokument wysłany',
      text: `${actor} oznaczył(a) jako wysłane: ${count > 1 ? many : one}.`,
    },
  };
  const v = variants[p.decision ?? ''] ?? {
    heading: 'Zmiana w obiegu dokumentu',
    text: `Zmienił się status: ${count > 1 ? many : one}.`,
  };
  return {
    subject: title ? `${v.heading}: ${title}` : v.heading,
    heading: v.heading,
    blocks: [
      { type: 'p', text: v.text },
      ...signingTitlesSection(p.titles, count, ctx),
      ...(notes ? [{ type: 'note' as const, text: `Uwagi: ${notes}` }] : []),
    ],
    cta: { label: count > 1 ? 'Otwórz dokumenty' : 'Otwórz dokument', path },
    push: { title: v.heading, body: 'Otwórz, aby zobaczyć szczegóły.', path },
  };
}

function digestMessage(raw: unknown, ctx: RenderContext): Message {
  const d = DigestPayload.parse(raw ?? {});
  const weekly = d.period === 'week';
  const blocks: Block[] = [];
  const caseItem = (c: z.infer<typeof DigestCase>, meta: string) => ({
    text: ctx.includeTitles ? c.title || 'Sprawa bez tytułu' : 'Sprawa',
    meta,
    path: `/biuro/sprawy?open=${encodeURIComponent(c.id)}`,
  });

  if (d.overdue_count > 0) {
    blocks.push({
      type: 'section',
      title: `Przeterminowane sprawy (${d.overdue_count})`,
      items: d.overdue_cases.map((c) =>
        caseItem(c, `termin ${formatDay(c.due_date)}${c.days_overdue ? `, ${plural(c.days_overdue, 'dzień', 'dni', 'dni')} po terminie` : ''}`),
      ),
      more: d.overdue_count > d.overdue_cases.length ? `i ${d.overdue_count - d.overdue_cases.length} więcej w Sprawach` : undefined,
    });
  }
  if (d.due_count > 0) {
    blocks.push({
      type: 'section',
      title: weekly ? `Terminy w tym tygodniu (${d.due_count})` : `Terminy na dziś (${d.due_count})`,
      items: d.due_cases.map((c) => caseItem(c, `termin ${formatDay(c.due_date)}`)),
      more: d.due_count > d.due_cases.length ? `i ${d.due_count - d.due_cases.length} więcej w Sprawach` : undefined,
    });
  }
  if (d.events_count > 0) {
    blocks.push({
      type: 'section',
      title: weekly ? `Twoje wydarzenia w tym tygodniu (${d.events_count})` : `Twoje wydarzenia dziś (${d.events_count})`,
      items: d.events.map((e) => ({
        text: ctx.includeTitles ? e.title || 'Wydarzenie' : 'Wydarzenie',
        meta: [formatEventTime(e.starts_at, e.all_day), ctx.includeTitles ? e.location : null].filter(Boolean).join(' · '),
        path: `/biuro/kalendarz?open=${encodeURIComponent(e.id)}`,
      })),
      more: d.events_count > d.events.length ? `i ${d.events_count - d.events.length} więcej w Kalendarzu` : undefined,
    });
  }
  const interpItems: { text: string; path: string }[] = [];
  if (d.interpellations?.remarks) interpItems.push({ text: `${plural(d.interpellations.remarks, 'interpelacja', 'interpelacje', 'interpelacji')} z uwagami do poprawy`, path: '/biuro/interpelacje' });
  if (d.interpellations?.send_overdue) interpItems.push({ text: `${plural(d.interpellations.send_overdue, 'zaakceptowana interpelacja', 'zaakceptowane interpelacje', 'zaakceptowanych interpelacji')} po terminie wysłania`, path: '/biuro/interpelacje' });
  if (d.office?.interpellations_pending) interpItems.push({ text: `${plural(d.office.interpellations_pending, 'interpelacja czeka', 'interpelacje czekają', 'interpelacji czeka')} na decyzję`, path: '/biuro/interpelacje' });
  if (interpItems.length) blocks.push({ type: 'section', title: 'Interpelacje', items: interpItems });

  if (d.office && (d.office.overdue_count || d.office.unassigned_count || d.office.public_new_count)) {
    blocks.push({
      type: 'section',
      title: 'Sprawy całego biura',
      items: [
        { text: `Przeterminowane: ${d.office.overdue_count}`, path: '/biuro/sprawy' },
        { text: `Otwarte bez przypisanej osoby: ${d.office.unassigned_count}`, path: '/biuro/sprawy' },
        { text: `Nowe zgłoszenia z formularza: ${d.office.public_new_count}`, path: '/biuro/sprawy' },
      ],
    });
  }
  if (d.budget && d.budget.limit > 0) {
    const pct = Math.round((d.budget.spent / d.budget.limit) * 100);
    blocks.push({
      type: 'section',
      title: 'Budżet biura w tym miesiącu',
      items: [
        { text: `Wydano ${money(d.budget.spent)} z ${money(d.budget.limit)} (${pct}%)`, path: '/biuro/budzet' },
        ...(d.budget.missing_invoices
          ? [{ text: `${plural(d.budget.missing_invoices, 'wydatek', 'wydatki', 'wydatków')} bez pliku faktury`, path: '/biuro/budzet' }]
          : []),
      ],
    });
  }

  const summary = [
    d.overdue_count ? plural(d.overdue_count, 'przeterminowana sprawa', 'przeterminowane sprawy', 'przeterminowanych spraw') : null,
    d.due_count ? plural(d.due_count, 'termin', 'terminy', 'terminów') : null,
    d.events_count ? plural(d.events_count, 'wydarzenie', 'wydarzenia', 'wydarzeń') : null,
  ]
    .filter(Boolean)
    .join(', ');
  const heading = weekly ? 'Podsumowanie tygodnia' : 'Plan dnia';
  const range = weekly ? `${formatDay(d.today)} - ${formatDay(d.horizon)}` : formatDay(d.today);
  return {
    subject: summary ? `${heading}: ${summary}` : heading,
    heading,
    blocks: [{ type: 'p', text: range }, ...blocks],
    cta: { label: 'Otwórz pulpit', path: '/biuro' },
    push: { title: heading, body: summary ? `${summary[0].toUpperCase()}${summary.slice(1)}.` : 'Otwórz pulpit.', path: '/biuro' },
  };
}

function testMessage(channel: string): Message {
  return {
    subject: 'Test powiadomień',
    heading: 'Test powiadomień',
    blocks: [
      {
        type: 'p',
        text:
          channel === 'push'
            ? 'To jest powiadomienie testowe z portalu biura.'
            : 'To jest wiadomość testowa z portalu biura. Skoro ją widzisz, powiadomienia e-mail działają.',
      },
    ],
    cta: { label: 'Ustawienia powiadomień', path: '/biuro/profil#powiadomienia' },
    push: { title: 'Test powiadomień', body: 'Powiadomienia push działają na tym urządzeniu.', path: '/biuro/profil#powiadomienia' },
  };
}

function buildMessage(kind: string, payload: unknown, ctx: RenderContext): Message {
  switch (kind) {
    case 'security_integration':
      return integrationMessage(payload);
    case 'security_account':
      return accountMessage(payload, ctx);
    case 'case_assigned':
    case 'case_deadline':
    case 'public_submission':
      return caseMessage(kind, payload, ctx);
    case 'case_mention':
    case 'case_comment':
      return caseCommentMessage(kind, payload, ctx);
    case 'event_assigned':
      return eventMessage(payload, ctx);
    case 'interpellation_review':
    case 'interpellation_decision':
      return interpellationMessage(kind, payload, ctx);
    case 'signing_request':
      return signingRequestMessage(payload, ctx);
    case 'signing_decision':
      return signingDecisionMessage(payload, ctx);
    case 'responsibility':
      return responsibilityMessage(payload);
    case 'weekly_digest':
    case 'daily_digest':
      return digestMessage(payload, ctx);
    case 'test': {
      const p = z.object({ channel: optStr }).loose().parse(payload ?? {});
      return testMessage(p.channel ?? 'email');
    }
    default:
      throw new Error(`Nieznany rodzaj powiadomienia: ${kind}`);
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function oneLine(value: string, max: number): string {
  const flat = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const COLOR_TEXT = '#232323';
const COLOR_MUTED = '#6b7280';
const COLOR_PRIMARY = '#1e3a8a';
const COLOR_BORDER = '#e5e7eb';

function blockHtml(block: Block, url: (path: string) => string): string {
  switch (block.type) {
    case 'p':
      return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${COLOR_TEXT}">${esc(block.text)}</p>`;
    case 'note':
      return `<p style="margin:0 0 14px;padding:10px 12px;background:#f8fafc;border-left:3px solid ${COLOR_PRIMARY};font-size:14px;line-height:1.5;color:${COLOR_TEXT}">${esc(block.text)}</p>`;
    case 'facts':
      if (!block.rows.length) return '';
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border-collapse:collapse;font-size:14px">${block.rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:4px 16px 4px 0;color:${COLOR_MUTED};vertical-align:top">${esc(k)}</td><td style="padding:4px 0;color:${COLOR_TEXT}">${esc(v)}</td></tr>`,
        )
        .join('')}</table>`;
    case 'section':
      return `<h2 style="margin:20px 0 8px;font-size:15px;color:${COLOR_TEXT}">${esc(block.title)}</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">${block.items
        .map(
          (item) =>
            `<tr><td style="padding:8px 0;border-top:1px solid ${COLOR_BORDER}">${
              item.path
                ? `<a href="${esc(url(item.path))}" style="color:${COLOR_PRIMARY};text-decoration:none;font-weight:600">${esc(item.text)}</a>`
                : `<span style="font-weight:600">${esc(item.text)}</span>`
            }${item.meta ? `<br><span style="color:${COLOR_MUTED};font-size:13px">${esc(item.meta)}</span>` : ''}</td></tr>`,
        )
        .join('')}</table>${block.more ? `<p style="margin:6px 0 0;font-size:13px;color:${COLOR_MUTED}">${esc(block.more)}</p>` : ''}`;
  }
}

function blockText(block: Block, url: (path: string) => string): string {
  switch (block.type) {
    case 'p':
    case 'note':
      return block.text;
    case 'facts':
      return block.rows.map(([k, v]) => `${k}: ${v}`).join('\n');
    case 'section':
      return [
        block.title.toUpperCase(),
        ...block.items.map((i) => `- ${i.text}${i.meta ? ` (${i.meta})` : ''}${i.path ? `\n  ${url(i.path)}` : ''}`),
        ...(block.more ? [block.more] : []),
      ].join('\n');
  }
}

export function renderNotification(kind: string, payload: unknown, ctx: RenderContext): Rendered {
  const message = buildMessage(kind, payload, ctx);
  const url = (path: string) => `${ctx.appUrl}${path}`;
  const prefsUrl = url('/biuro/profil#powiadomienia');
  const subject = oneLine(message.subject, 180);
  const body = message.blocks.map((b) => blockHtml(b, url)).join('');
  const cta = message.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr><td style="border-radius:6px;background:${COLOR_PRIMARY}"><a href="${esc(url(message.cta.path))}" style="display:inline-block;padding:11px 20px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(message.cta.label)}</a></td></tr></table>`
    : '';

  const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLOR_TEXT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${COLOR_BORDER};border-radius:8px">
<tr><td style="padding:16px 24px;border-bottom:1px solid ${COLOR_BORDER};font-size:13px;font-weight:600;color:${COLOR_MUTED}">${esc(ctx.officeName)}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:${COLOR_TEXT}">${esc(message.heading)}</h1>
${body}${cta}
</td></tr></table>
<p style="max-width:560px;margin:14px auto 0;font-size:12px;line-height:1.5;color:${COLOR_MUTED}">Wiadomość automatyczna z portalu ${esc(ctx.officeName)}. <a href="${esc(prefsUrl)}" style="color:${COLOR_MUTED}">Zmień ustawienia powiadomień</a>.</p>
</td></tr></table>
</body></html>`;

  const text = [
    message.heading,
    '',
    ...message.blocks.map((b) => blockText(b, url)).filter(Boolean).flatMap((t) => [t, '']),
    ...(message.cta ? [`${message.cta.label}: ${url(message.cta.path)}`, ''] : []),
    '--',
    `Wiadomość automatyczna z portalu ${ctx.officeName}.`,
    `Ustawienia powiadomień: ${prefsUrl}`,
  ].join('\n');

  return {
    subject,
    html,
    text,
    push: {
      title: oneLine(message.push.title, 80),
      body: oneLine(message.push.body, 160),
      url: message.push.path,
      tag: kind,
    },
  };
}

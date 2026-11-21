import {
  AtSign,
  Bell,
  CalendarCheck,
  Clock,
  FilePen,
  FileSignature,
  FolderInput,
  Inbox,
  MessageSquare,
  Plug,
  ScrollText,
  ShieldAlert,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';

import { INSTANCE } from '@/lib/instance';
import { notificationKindLabel } from '@/lib/notifications';

// Powiadomienia w aplikacji (dzwonek): wiersz `get_my_inbox()` → tytuł, opis, link, ikona.
// Payloady jak w wywołaniach `notify()` w migracjach. Teksty e-maila i push renderuje serwer
// (api/_lib/notifications/templates.ts, buildMessage); mapy SERVICE_* i MODULE_* są tu powielone
// celowo - przy nowym rodzaju albo zmianie linku poprawić oba pliki (lista w powiadomienia.md).
// Treść widzi tylko właściciel w zalogowanej sesji aal2, więc tytuły są pokazywane zawsze
// (include_titles dotyczy wyłącznie e-maili). Href zawsze ze stałych tras + encodeURIComponent.

/** Wiersz `get_my_inbox(p_limit, p_before, p_before_id)`. */
export interface InboxItem {
  id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
}

export interface RenderedInboxItem {
  title: string;
  body: string;
  href: string;
  icon: LucideIcon;
  /** true = link prowadzi do konkretnego rekordu (auto-odczyt po wejściu na ten adres). */
  record: boolean;
}

type Payload = Record<string, unknown>;

function str(p: Payload, key: string): string {
  const v = p[key];
  return typeof v === 'string' ? v.trim() : '';
}

function num(p: Payload, key: string): number | null {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function quoted(value: string): string {
  return value ? `„${value}”` : '';
}

/** Polska odmiana liczebnika: 1 sprawa, 2 sprawy, 5 spraw. */
function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return `1 ${one}`;
  const mod10 = n % 10;
  const mod100 = n % 100;
  const isFew = mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14);
  return `${n} ${isFew ? few : many}`;
}

function withId(base: string, id: string, mode: 'open' | 'path'): string {
  if (!id) return base;
  return mode === 'open' ? `${base}?open=${encodeURIComponent(id)}` : `${base}/${encodeURIComponent(id)}`;
}

/** Link do rekordu (gdy jest identyfikator) albo do listy modułu. */
function recordLink(base: string, id: string, mode: 'open' | 'path'): { href: string; record: boolean } {
  return { href: withId(base, id, mode), record: Boolean(id) };
}

const DAY_FMT = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long' });
const DATETIME_FMT = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDay(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return '';
  return DAY_FMT.format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function formatInstant(value: string, allDay = false): string {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return '';
  return allDay ? DAY_FMT.format(d) : DATETIME_FMT.format(d);
}

const SERVICE_LABELS: Record<string, string> = {
  mcp: 'Token MCP',
  oauth: 'Aplikacja OAuth',
  ics: 'Kalendarz ICS',
};

// Strona MCP istnieje tylko z włączonym AI (INSTANCE_AI=on); inaczej stare powiadomienia prowadzą do listy integracji.
const MCP_PATH = INSTANCE.ai ? '/biuro/admin/integracje/mcp' : '/biuro/admin/integracje';
const SERVICE_PATHS: Record<string, string> = {
  mcp: MCP_PATH,
  oauth: MCP_PATH,
  ics: '/biuro/admin/integracje',
};

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

function signingLink(count: number, documentId: string): { href: string; record: boolean } {
  return count === 1 ? recordLink('/biuro/dokumenty', documentId, 'path') : { href: '/biuro/dokumenty', record: false };
}

/** Dokumenty do podpisu: liczba dokumentów operacji i tytuł pierwszego (payload `count` + `titles`). */
function signingSummary(p: Payload): { count: number; title: string } {
  const c = num(p, 'count');
  const titles = p.titles;
  const first = Array.isArray(titles) && typeof titles[0] === 'string' ? titles[0].trim() : '';
  return { count: c && c > 1 ? Math.floor(c) : 1, title: first };
}

/** Treść pozycji dzwonka; nieznany rodzaj dostaje treść ogólną (nigdy wyjątek). */
export function renderInboxItem(kind: string, rawPayload: unknown): RenderedInboxItem {
  const p: Payload =
    rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload) ? (rawPayload as Payload) : {};
  switch (kind) {
    case 'security_integration': {
      const service = str(p, 'service');
      const name = quoted(str(p, 'name'));
      return {
        title: 'Nowa usługa podłączona do konta',
        body: `${SERVICE_LABELS[service] ?? 'Nowa usługa'}${name ? ` ${name}` : ''}. Jeśli to nie Ty, unieważnij dostęp.`,
        href: SERVICE_PATHS[service] ?? '/biuro/admin/integracje',
        record: false,
        icon: Plug,
      };
    }
    case 'security_account': {
      const actor = str(p, 'actor');
      const by = actor ? ` Wykonał(a): ${actor}.` : '';
      const event = str(p, 'event');
      const profile = { href: '/biuro/profil', record: false, icon: ShieldAlert };
      if (event === 'sessions_revoked') {
        return { title: 'Wylogowano Cię ze wszystkich urządzeń', body: `Zakończono Twoje sesje i usunięto 2FA.${by}`, ...profile };
      }
      if (event === 'mfa_reset') {
        return { title: 'Zresetowano 2FA', body: `Przy następnym logowaniu ustawisz 2FA ponownie.${by}`, ...profile };
      }
      return { title: 'Zmieniono Twoje uprawnienia', body: `Zmieniono rolę albo zakres dostępu do danych.${by}`, ...profile };
    }
    case 'case_assigned': {
      const title = quoted(str(p, 'title'));
      const actor = str(p, 'actor');
      const due = formatDay(str(p, 'due_date'));
      return {
        title: 'Przypisano Ci sprawę',
        body: [title || 'Nowa sprawa wyborcy', actor ? `przypisał(a): ${actor}` : '', due ? `termin ${due}` : '']
          .filter(Boolean)
          .join(' · '),
        ...recordLink('/biuro/sprawy', str(p, 'case_id'), 'open'),
        icon: FolderInput,
      };
    }
    case 'case_deadline': {
      const title = quoted(str(p, 'title'));
      const due = formatDay(str(p, 'due_date'));
      return {
        title: 'Jutro mija termin sprawy',
        body: `${title ? `Sprawa ${title}` : 'Twoja sprawa'}${due ? ` - termin ${due}` : ''}.`,
        ...recordLink('/biuro/sprawy', str(p, 'case_id'), 'open'),
        icon: Clock,
      };
    }
    case 'case_mention':
    case 'case_comment': {
      const mention = kind === 'case_mention';
      const actor = str(p, 'actor_name');
      const title = quoted(str(p, 'case_title'));
      const excerpt = str(p, 'excerpt');
      const who = actor || 'Ktoś';
      return {
        title: mention ? `${who} wspomniał(a) o Tobie` : `${who} skomentował(a) sprawę`,
        body: [title, excerpt].filter(Boolean).join(': ') || (mention ? 'Wzmianka w komentarzu do sprawy.' : 'Nowy komentarz w sprawie.'),
        ...recordLink('/biuro/sprawy', str(p, 'case_id'), 'open'),
        icon: mention ? AtSign : MessageSquare,
      };
    }
    case 'public_submission': {
      const count = num(p, 'count');
      if (count && count > 1) {
        return {
          title: `Formularz na stronie: ${plural(Math.floor(count), 'nowe zgłoszenie', 'nowe zgłoszenia', 'nowych zgłoszeń')}`,
          body: 'Zgłoszenia czekają w Sprawach ze statusem „Nowa”.',
          href: '/biuro/sprawy',
          record: false,
          icon: Inbox,
        };
      }
      const title = quoted(str(p, 'title'));
      return {
        title: 'Nowe zgłoszenie z formularza',
        body: title ? `${title} - czeka w Sprawach.` : 'Zgłoszenie czeka w Sprawach ze statusem „Nowa”.',
        ...recordLink('/biuro/sprawy', str(p, 'case_id'), 'open'),
        icon: Inbox,
      };
    }
    case 'event_assigned': {
      const title = quoted(str(p, 'title'));
      const when = formatInstant(str(p, 'starts_at'), p.all_day === true);
      const actor = str(p, 'actor');
      return {
        title: 'Przypisano Ci wydarzenie',
        body: [title || 'Wydarzenie w kalendarzu', when, actor ? `przypisał(a): ${actor}` : ''].filter(Boolean).join(' · '),
        ...recordLink('/biuro/kalendarz', str(p, 'event_id'), 'open'),
        icon: CalendarCheck,
      };
    }
    case 'interpellation_review': {
      const subject = quoted(str(p, 'subject'));
      const revised = str(p, 'status') === 'po_poprawkach';
      return {
        title: revised ? 'Poprawiona interpelacja czeka na decyzję' : 'Nowa interpelacja czeka na decyzję',
        body: subject ? `Interpelacja ${subject}.` : 'Otwórz, aby podjąć decyzję.',
        ...recordLink('/biuro/interpelacje', str(p, 'interpellation_id'), 'path'),
        icon: ScrollText,
      };
    }
    case 'interpellation_decision': {
      const subject = quoted(str(p, 'subject'));
      const actor = str(p, 'actor');
      const headings: Record<string, string> = {
        zaakceptowana: 'Interpelacja zaakceptowana',
        uwagi: 'Uwagi do interpelacji',
        odrzucona: 'Interpelacja odrzucona',
      };
      const notes = str(p, 'review_notes');
      return {
        title: headings[str(p, 'status')] ?? 'Decyzja w sprawie interpelacji',
        body:
          [subject, notes ? `Uwagi: ${notes}` : '', actor ? `decyzja: ${actor}` : ''].filter(Boolean).join(' · ') ||
          'Otwórz, aby zobaczyć szczegóły.',
        ...recordLink('/biuro/interpelacje', str(p, 'interpellation_id'), 'path'),
        icon: ScrollText,
      };
    }
    case 'signing_request': {
      const { count, title: first } = signingSummary(p);
      const actor = str(p, 'actor_name');
      const title = count === 1 ? quoted(first) : '';
      const heading = p.revised === true
        ? 'Poprawiony dokument czeka na podpis'
        : count > 1
          ? `Dokumenty do podpisu: ${count}`
          : 'Dokument czeka na podpis';
      return {
        title: heading,
        body:
          [title || (count > 1 ? plural(count, 'dokument', 'dokumenty', 'dokumentów') : ''), actor ? `przekazał(a): ${actor}` : '']
            .filter(Boolean)
            .join(' · ') || 'Otwórz, aby zobaczyć dokument.',
        ...signingLink(count, str(p, 'document_id')),
        icon: FileSignature,
      };
    }
    case 'signing_decision': {
      const { count, title: first } = signingSummary(p);
      const many = count > 1;
      const headings: Record<string, string> = {
        do_poprawy: many ? `Dokumenty do poprawy: ${count}` : 'Dokument do poprawy',
        podpisany: many ? `Podpisane dokumenty: ${count}` : 'Dokument podpisany',
        wyslany: many ? `Wysłane dokumenty: ${count}` : 'Dokument wysłany',
      };
      const title = !many ? quoted(first) : '';
      const actor = str(p, 'actor_name');
      const notes = str(p, 'notes');
      return {
        title: headings[str(p, 'decision')] ?? 'Zmiana w obiegu dokumentu',
        body:
          [title, notes ? `Uwagi: ${notes}` : '', actor].filter(Boolean).join(' · ') || 'Otwórz, aby zobaczyć szczegóły.',
        ...signingLink(count, str(p, 'document_id')),
        icon: FilePen,
      };
    }
    case 'responsibility': {
      const module = str(p, 'module');
      const label = MODULE_LABELS[module] ?? (module || 'obszar');
      const href = MODULE_PATHS[module] ?? '/biuro';
      const actor = str(p, 'actor');
      return {
        title: `Zostajesz opiekunem obszaru: ${label}`,
        body: actor ? `Przypisał(a): ${actor}.` : 'Aktywność w tym obszarze pokazuje Puls Biura.',
        href,
        record: false,
        icon: UserCheck,
      };
    }
    default: {
      // Rodzaj z katalogu bez gałęzi wyżej: jego etykieta; zupełnie nieznany: treść ogólna.
      const label = notificationKindLabel(kind);
      return {
        title: label === kind ? 'Nowe powiadomienie' : label,
        body: 'Otwórz portal, aby zobaczyć szczegóły.',
        href: '/biuro',
        record: false,
        icon: Bell,
      };
    }
  }
}

export interface InboxDayGroup {
  key: 'today' | 'yesterday' | 'earlier';
  label: string;
  items: InboxItem[];
}

/** Grupy „Dzisiaj”, „Wczoraj”, „Wcześniej” (czas lokalny); puste grupy pominięte, kolejność wejścia zachowana. */
export function groupInboxByDay(items: InboxItem[], now: Date = new Date()): InboxDayGroup[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const groups: InboxDayGroup[] = [
    { key: 'today', label: 'Dzisiaj', items: [] },
    { key: 'yesterday', label: 'Wczoraj', items: [] },
    { key: 'earlier', label: 'Wcześniej', items: [] },
  ];
  for (const item of items) {
    const t = new Date(item.created_at).getTime();
    groups[t >= today ? 0 : t >= yesterday ? 1 : 2].items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}

/**
 * Czy link pozycji wskazuje bieżący adres: ta sama ścieżka i ten sam parametr `open`
 * (pozostałe parametry bez znaczenia). `search` z `useLocation()` (z „?” albo pusty).
 */
export function inboxHrefMatches(href: string, pathname: string, search: string): boolean {
  const [hrefPath, hrefQuery = ''] = href.split('?');
  // Bez końcowych „/” (poza samym „/”).
  const [a, b] = [hrefPath, pathname].map((path) => (path.length > 1 ? path.replace(/\/+$/, '') : path));
  if (a !== b) return false;
  return new URLSearchParams(hrefQuery).get('open') === new URLSearchParams(search).get('open');
}

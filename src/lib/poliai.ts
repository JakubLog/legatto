import {
  Activity,
  ArrowUpRight,
  Briefcase,
  Building2,
  Calendar,
  CalendarClock,
  CircleUserRound,
  FileText,
  History,
  ListChecks,
  Mail,
  MapPin,
  MessageSquareText,
  PenLine,
  Search,
  Settings,
  Sparkles,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

// Ikona przycisku kolejnego kroku: pierwsza pasująca reguła po etykiecie/poleceniu/ścieżce.
const ACTION_ICONS: [pattern: RegExp, Icon: LucideIcon][] = [
  [/interpelac/i, FileText],
  [/przesuń|przesun|zaplanuj|przełóż|przeloz/i, CalendarClock],
  [/kalendar|wydarzen|spotkan|wizyt|tydzie|jutro/i, Calendar],
  [/budżet|budzet|wydat|koszt|faktur|paragon/i, Wallet],
  [/puls|obszar|aktywno|opiekun/i, Activity],
  [/dodaj kontakt|nowy kontakt/i, UserPlus],
  [/kontakt|wyborc|osob/i, UserRound],
  [/zesp|pracownik|użytkownik|uzytkownik/i, Users],
  [/sprawy?|sprawę|zgłosze|zglosze/i, Briefcase],
  [/newsletter|mail|wiadomo/i, Mail],
  [/teren|powiat|gmin|okręg|okreg/i, MapPin],
  [/napisz|przygotuj|szkic|redag|notatk/i, PenLine],
  [/znajdź|znajdz|szukaj|wyszuk/i, Search],
  [/podsumuj|lista|zaległ|zaleg|priorytet/i, ListChecks],
  [/poprzedni|wcześniej|historia/i, MessageSquareText],
];

export function getActionIcon(action: { label: string; prompt?: string; href?: string }): LucideIcon {
  const haystack = `${action.label} ${action.prompt ?? ''} ${action.href ?? ''}`;
  const match = ACTION_ICONS.find(([pattern]) => pattern.test(haystack));
  if (match) return match[1];
  return action.href ? ArrowUpRight : Sparkles;
}

/** Narzędzie pamięci między rozmowami (api/_lib/poliai/memory.ts). */
export const PAST_CONVERSATIONS_TOOL = 'poliai_past_conversations';

// ---------------------------------------------------------------------------
// Kontrakt POST /api/poliai (ai-lib/plans/2026-10-25-poliai.md)
// ---------------------------------------------------------------------------

/** Typ załącznika PoliAI (ai-lib/plans/2026-10-26-poliai-zalaczniki.md). */
export type AttachmentKind = 'image' | 'pdf' | 'docx' | 'text';

/** Załącznik w wiadomości użytkownika; treść (strony) leży w `poliai_attachments` i w buckecie. */
export interface AttachmentBlock {
  type: 'attachment';
  id: string;
  name: string;
  kind: AttachmentKind;
  mime: string;
  /** Rozmiar po kompresji (bajty). */
  size: number;
  pages: number;
}

/** Prywatny bucket na obrazy stron załączników: `<user_id>/<attachment_id>/p001.webp`. */
export const POLIAI_ATTACHMENTS_BUCKET = 'poliai-attachments';

export type ApiBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | AttachmentBlock;

export type ToolUseBlock = Extract<ApiBlock, { type: 'tool_use' }>;
export type ToolResultBlock = Extract<ApiBlock, { type: 'tool_result' }>;

export interface ApiMessage {
  role: 'user' | 'assistant';
  content: string | ApiBlock[];
}

export type DraftBlockType = 'thinking' | 'text' | 'tool_use';

export type PoliAIEvent =
  | { type: 'conversation'; id: string; title: string | null }
  | { type: 'assistant_start' }
  | { type: 'intro_delta'; text: string }
  | { type: 'intro_done' }
  | { type: 'suggestions'; actions: SuggestedAction[] }
  | { type: 'block_start'; index: number; block: { type: DraftBlockType; id?: string; name?: string } }
  | { type: 'block_delta'; index: number; text: string }
  | { type: 'assistant_message'; message: ApiMessage }
  | { type: 'tool_running'; id: string; name: string }
  | { type: 'tool_results'; message: ApiMessage }
  | { type: 'approval_required'; ids: string[] }
  | { type: 'continue' }
  | { type: 'done'; stop_reason: string }
  | { type: 'title'; title: string }
  | { type: 'compacted'; context_from: number }
  | { type: 'error'; error: string; code?: string };

export interface PoliAIRequestBody {
  conversation_id?: string;
  message?: string;
  /** Załączniki przygotowane przez `POST /api/poliai?op=attachment` (maks. 5). */
  attachment_ids?: string[];
  approvals?: Record<string, boolean>;
  page?: string;
}

/** Blok szkicu wiadomości asystenta budowany ze zdarzeń `block_start` / `block_delta`. */
export interface DraftBlock {
  type: DraftBlockType;
  id?: string;
  name?: string;
  text: string;
}

export interface SuggestedAction {
  label: string;
  prompt?: string;
  href?: string;
}

/** Dodatki tury spoza historii API: wstęp szybkiego modelu i przyciski kolejnych kroków. */
export interface TurnExtras {
  intro: string;
  /** Wstęp skończony (albo go nie będzie) - dopiero wtedy pokazujemy kafelek pracy i odpowiedź. */
  introDone: boolean;
  actions: SuggestedAction[];
}

// ---------------------------------------------------------------------------
// Parser SSE
// ---------------------------------------------------------------------------

function parseEvent(data: string): PoliAIEvent | null {
  try {
    const parsed: unknown = JSON.parse(data);
    // Ufamy kształtowi zdarzeń z własnego backendu; sprawdzamy tylko dyskryminator.
    if (parsed && typeof parsed === 'object' && 'type' in parsed && typeof parsed.type === 'string') {
      return parsed as PoliAIEvent;
    }
  } catch {
    // Niepełny lub uszkodzony JSON - pomijamy zdarzenie.
  }
  return null;
}

/**
 * Czyta strumień `text/event-stream` i zwraca zdarzenia z linii `data:`. Obsługuje granice
 * chunków w środku linii, CRLF, wieloliniowe `data:` (łączone `\n`) i komentarze (`:`).
 */
export async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<PoliAIEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];

  const flush = (): PoliAIEvent | null => {
    if (dataLines.length === 0) return null;
    const event = parseEvent(dataLines.join('\n'));
    dataLines = [];
    return event;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          const event = flush();
          if (event) yield event;
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(line.startsWith('data: ') ? 6 : 5));
        }
        newline = buffer.indexOf('\n');
      }
      if (done) break;
    }
    if (buffer.startsWith('data:')) dataLines.push(buffer.slice(buffer.startsWith('data: ') ? 6 : 5));
    const last = flush();
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Etykiety narzędzi
// ---------------------------------------------------------------------------

interface ToolModule {
  label: string;
  Icon: LucideIcon;
}

// Kolejność ma znaczenie: dłuższe prefiksy przed krótszymi.
const TOOL_MODULES: [prefix: string, module: ToolModule][] = [
  ['expense_categories_', { label: 'Słowniki', Icon: ListChecks }],
  ['case_categories_', { label: 'Słowniki', Icon: ListChecks }],
  ['ics_sources_', { label: 'Kalendarze ICS', Icon: CalendarClock }],
  ['interpellations_', { label: 'Interpelacje', Icon: FileText }],
  ['contacts_', { label: 'Kontakty', Icon: UserRound }],
  ['settings_', { label: 'Ustawienia', Icon: Settings }],
  ['offices_', { label: 'Biura', Icon: Building2 }],
  ['events_', { label: 'Kalendarz', Icon: Calendar }],
  ['budget_', { label: 'Budżet', Icon: Wallet }],
  ['powiaty_', { label: 'Słowniki', Icon: MapPin }],
  ['person_', { label: 'Zespół', Icon: Users }],
  ['cases_', { label: 'Sprawy', Icon: Briefcase }],
  ['audit_', { label: 'Dziennik zmian', Icon: History }],
  ['users_', { label: 'Zespół', Icon: Users }],
  ['gminy_', { label: 'Słowniki', Icon: MapPin }],
  ['me_', { label: 'Ty/profil', Icon: CircleUserRound }],
];

const TOOL_VERBS: Record<string, string> = {
  list: 'Przegląda',
  get: 'Czyta',
  search: 'Wyszukuje',
  agenda: 'Sprawdza agendę',
  profile: 'Sprawdza profil',
  briefing: 'Przygotowuje przegląd',
  status: 'Sprawdza status',
  list_upcoming: 'Przegląda nadchodzące',
  create: 'Utworzy',
  update: 'Zmieni',
  update_status: 'Zmieni',
  add_note: 'Doda notatkę',
  delete: 'Usunie',
  submit: 'Wgra',
  resubmit: 'Wgra',
  decide: 'Zdecyduje',
  mark_sent: 'Oznaczy jako wysłaną',
  sync: 'Zsynchronizuje',
};

export interface ToolMeta {
  /** Czasownik, np. „Przegląda”; dla nieznanych narzędzi surowa nazwa. */
  verb: string;
  /** Moduł, np. „Sprawy”; pusty dla nieznanych narzędzi. */
  module: string;
  Icon: LucideIcon;
}

export function getToolMeta(name: string): ToolMeta {
  if (name === PAST_CONVERSATIONS_TOOL) return { verb: 'Przeglądam poprzednie konwersacje', module: '', Icon: History };
  const entry = TOOL_MODULES.find(([prefix]) => name.startsWith(prefix));
  if (!entry) return { verb: name, module: '', Icon: Wrench };
  const [prefix, { label, Icon }] = entry;
  const verb = TOOL_VERBS[name.slice(prefix.length)];
  return verb ? { verb, module: label, Icon } : { verb: name, module: label, Icon };
}

export function isDestructiveTool(name: string): boolean {
  return name.endsWith('_delete');
}

// ---------------------------------------------------------------------------
// Pomocnicze: treść wiadomości, akcje, wartości
// ---------------------------------------------------------------------------

export function messageBlocks(message: ApiMessage): ApiBlock[] {
  return typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
}

export function messageText(message: ApiMessage): string {
  return messageBlocks(message)
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('\n\n');
}

/** Wiadomość użytkownika z tekstem lub załącznikiem (a nie tylko z `tool_result`) = początek nowej tury. */
export function isUserPromptMessage(message: ApiMessage): boolean {
  return message.role === 'user' && messageBlocks(message).some((b) => b.type === 'text' || b.type === 'attachment');
}

export function toolUses(message: ApiMessage): ToolUseBlock[] {
  return messageBlocks(message).filter((b): b is ToolUseBlock => b.type === 'tool_use');
}

/** Przyciski z serwera; `href` tylko wewnątrz aplikacji (`/biuro…`), maks. 4. */
export function sanitizeActions(actions: SuggestedAction[]): SuggestedAction[] {
  return actions
    .filter((a) => a.label.trim() && (a.prompt?.trim() || a.href?.startsWith('/biuro')))
    .map((a) => (a.prompt?.trim() ? { label: a.label, prompt: a.prompt } : { label: a.label, href: a.href }))
    .slice(0, 4);
}

/** Klucz tury (indeks wiadomości użytkownika z pytaniem), do której należy koniec historii. */
export function lastTurnKey(messages: ApiMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isUserPromptMessage(messages[i])) return i;
  }
  return 0;
}

/**
 * Dokleja pytanie użytkownika: załączniki, potem tekst (bez załączników - sam tekst jako string).
 * Gdy historia kończy się wiadomością użytkownika (wyniki narzędzi po "Zatrzymaj" albo pytanie
 * bez odpowiedzi po błędzie), bloki trafiają do niej - role muszą się przeplatać.
 */
export function appendUserMessage(
  messages: ApiMessage[],
  text: string | undefined,
  attachments: AttachmentBlock[],
): ApiMessage[] {
  const blocks: ApiBlock[] = text === undefined ? [...attachments] : [...attachments, { type: 'text', text }];
  const last = messages[messages.length - 1];
  if (last?.role !== 'user') {
    const content = attachments.length === 0 && text !== undefined ? text : blocks;
    return [...messages, { role: 'user', content }];
  }
  return [...messages.slice(0, -1), { role: 'user', content: [...messageBlocks(last), ...blocks] }];
}

export function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Wynik narzędzia do podglądu: ładny JSON, jeśli się da, przycięty do `max` znaków. */
export function formatToolResult(content: string, max = 2000): string {
  let pretty = content;
  try {
    pretty = JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    // Zwykły tekst - zostawiamy bez zmian.
  }
  return truncate(pretty, max);
}

// ---------------------------------------------------------------------------
// Tury i statusy narzędzi
// ---------------------------------------------------------------------------

export interface Turn {
  /** Indeks pierwszej wiadomości tury w historii - stabilny klucz. */
  key: number;
  /** Tekst pytania użytkownika ('' przy samych załącznikach, null, gdy historia zaczyna się od asystenta). */
  userText: string | null;
  /** Załączniki pytania użytkownika. */
  attachments: AttachmentBlock[];
  /** Wiadomości asystenta i wiadomości użytkownika z samymi `tool_result`. */
  messages: ApiMessage[];
}

export function groupTurns(messages: ApiMessage[]): Turn[] {
  const turns: Turn[] = [];
  messages.forEach((message, index) => {
    if (isUserPromptMessage(message)) {
      const attachments = messageBlocks(message).filter((b): b is AttachmentBlock => b.type === 'attachment');
      turns.push({ key: index, userText: messageText(message), attachments, messages: [] });
      return;
    }
    const current = turns[turns.length - 1];
    if (current) current.messages.push(message);
    else turns.push({ key: index, userText: null, attachments: [], messages: [message] });
  });
  return turns;
}

/** Wszystkie `tool_result` z historii po `tool_use_id`. */
export function indexToolResults(messages: ApiMessage[]): Map<string, ToolResultBlock> {
  const results = new Map<string, ToolResultBlock>();
  for (const message of messages) {
    if (message.role !== 'user' || typeof message.content === 'string') continue;
    for (const block of message.content) {
      if (block.type === 'tool_result') results.set(block.tool_use_id, block);
    }
  }
  return results;
}

export type ToolStatus = 'running' | 'queued' | 'done' | 'error' | 'awaiting_approval' | 'skipped';

export function getToolStatus(
  id: string,
  ctx: {
    result: ToolResultBlock | undefined;
    runningIds: readonly string[];
    pendingIds: readonly string[];
    /** Tura trwa (strumień aktywny) - brak wyniku oznacza „w kolejce”, nie „pominięto”. */
    live: boolean;
  },
): ToolStatus {
  if (ctx.result) return ctx.result.is_error ? 'error' : 'done';
  if (ctx.runningIds.includes(id)) return 'running';
  if (ctx.pendingIds.includes(id)) return 'awaiting_approval';
  return ctx.live ? 'queued' : 'skipped';
}

export type ProcessItem =
  | { kind: 'thinking'; key: string; text: string; live: boolean }
  | { kind: 'redacted'; key: string }
  | {
      kind: 'tool';
      key: string;
      name: string;
      /** `null` dla szkicu - wejście narzędzia znamy dopiero z `assistant_message`. */
      input: Record<string, unknown> | null;
      status: ToolStatus;
      result?: ToolResultBlock;
    };

export interface AnswerPart {
  key: string;
  text: string;
  live: boolean;
}

export interface TurnView {
  process: ProcessItem[];
  answer: AnswerPart[];
  /** Strumień trwa, a nie ma jeszcze żadnego bloku ani działającego narzędzia. */
  waiting: boolean;
}

/**
 * Widok tury: proces (myślenie, narzędzia, notatki modelu między narzędziami) i tekst odpowiedzi.
 * Odpowiedź = tekst wiadomości bez wywołań narzędzi. Klucze bloków szkicu pokrywają się z kluczami
 * po zatwierdzeniu wiadomości (indeks bloku w strumieniu = indeks w `content`), więc elementy
 * nie przemontowują się po `assistant_message`.
 */
export function buildTurnView(
  turn: Turn,
  ctx: {
    results: Map<string, ToolResultBlock>;
    draft: ReadonlyArray<DraftBlock | undefined>;
    live: boolean;
    runningIds: readonly string[];
    pendingIds: readonly string[];
  },
): TurnView {
  const view: TurnView = { process: [], answer: [], waiting: false };

  turn.messages.forEach((message, mi) => {
    if (message.role !== 'assistant') return;
    const callsTools = toolUses(message).length > 0;
    messageBlocks(message).forEach((block, bi) => {
      const key = `${turn.key}-${mi}-${bi}`;
      if (block.type === 'thinking') view.process.push({ kind: 'thinking', key, text: block.thinking, live: false });
      else if (block.type === 'redacted_thinking') view.process.push({ kind: 'redacted', key });
      else if (block.type === 'text' && block.text.trim()) {
        if (callsTools) view.process.push({ kind: 'thinking', key, text: block.text, live: false });
        else view.answer.push({ key, text: block.text, live: false });
      } else if (block.type === 'tool_use') {
        const result = ctx.results.get(block.id);
        view.process.push({
          kind: 'tool',
          key: `tool-${block.id}`,
          name: block.name,
          input: block.input,
          result,
          status: getToolStatus(block.id, { ...ctx, result }),
        });
      }
    });
  });

  let lastDraftIndex = -1;
  ctx.draft.forEach((block, i) => {
    if (block) lastDraftIndex = i;
  });
  const draftCallsTools = ctx.draft.some((b) => b?.type === 'tool_use');
  ctx.draft.forEach((block, i) => {
    if (!block) return;
    const key = `${turn.key}-${turn.messages.length}-${i}`;
    const streaming = ctx.live && i === lastDraftIndex;
    if (block.type === 'thinking' || (block.type === 'text' && draftCallsTools)) {
      view.process.push({ kind: 'thinking', key, text: block.text, live: streaming });
    } else if (block.type === 'text') view.answer.push({ key, text: block.text, live: streaming });
    else {
      const id = block.id ?? key;
      view.process.push({
        kind: 'tool',
        key: block.id ? `tool-${block.id}` : key,
        name: block.name ?? '',
        input: null,
        status: ctx.runningIds.includes(id) ? 'running' : 'queued',
      });
    }
  });

  view.waiting = ctx.live && lastDraftIndex === -1 && ctx.runningIds.length === 0;
  return view;
}

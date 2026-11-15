// Historia rozmowy PoliAI w formacie Anthropic Messages. Klient trzyma ja w pamieci i odsyla
// przy kazdym zadaniu (serwer jest bezstanowy). Walidacja zodem odrzuca nieznane pola
// (np. cache_control), bloki thinking przechodza bez zmian (podpis musi sie zgadzac).
// Wyjatek od formatu Anthropic: blok `attachment` (zalacznik uzytkownika, wiersz w
// poliai_attachments) - modelMessages rozwija go w obrazy stron i tekst (ModelMessage).

import { z } from 'zod';

const TextBlock = z.object({ type: z.literal('text'), text: z.string().max(100_000) });
const ThinkingBlock = z.object({
  type: z.literal('thinking'),
  thinking: z.string().max(200_000),
  signature: z.string().max(200_000),
});
const RedactedThinkingBlock = z.object({ type: z.literal('redacted_thinking'), data: z.string().max(200_000) });
const ToolUseBlock = z.object({
  type: z.literal('tool_use'),
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(100),
  input: z.record(z.string(), z.unknown()),
});
const ToolResultBlock = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string().min(1).max(200),
  content: z.string().max(100_000),
  is_error: z.boolean().optional(),
});

export const AttachmentKindSchema = z.enum(['image', 'pdf', 'docx', 'text']);
export const MAX_ATTACHMENT_PAGES = 30;
const AttachmentBlockSchema = z.object({
  type: z.literal('attachment'),
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  kind: AttachmentKindSchema,
  mime: z.string().max(100),
  size: z.number().int().nonnegative(),
  pages: z.number().int().min(0).max(MAX_ATTACHMENT_PAGES),
});

const AssistantBlock = z.discriminatedUnion('type', [TextBlock, ThinkingBlock, RedactedThinkingBlock, ToolUseBlock]);
const UserBlock = z.discriminatedUnion('type', [TextBlock, ToolResultBlock, AttachmentBlockSchema]);

const MessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.union([z.string().min(1).max(20_000), z.array(UserBlock).min(1)]) }),
  z.object({ role: z.literal('assistant'), content: z.array(AssistantBlock).min(1) }),
]);

export const HistorySchema = z.array(MessageSchema).max(400);

export const MAX_MESSAGE_ATTACHMENTS = 5;

export const RequestSchema = z.object({
  conversation_id: z.string().uuid().optional(),
  /**
   * Nowa wiadomosc uzytkownika (tekst i/lub zalaczniki). Brak obu = kontynuacja
   * (zatwierdzenie, ponowienie, `continue`).
   */
  message: z.string().trim().min(1).max(8000).optional(),
  attachment_ids: z
    .array(z.string().uuid())
    .max(MAX_MESSAGE_ATTACHMENTS)
    .refine((ids) => new Set(ids).size === ids.length, 'Powtórzony załącznik')
    .optional(),
  approvals: z.record(z.string(), z.boolean()).optional(),
  page: z.string().max(500).optional(),
});

export type AttachmentKind = z.infer<typeof AttachmentKindSchema>;
export type AttachmentBlock = z.infer<typeof AttachmentBlockSchema>;
export type ApiBlock =
  | z.infer<typeof TextBlock>
  | z.infer<typeof ThinkingBlock>
  | z.infer<typeof RedactedThinkingBlock>
  | z.infer<typeof ToolUseBlock>
  | z.infer<typeof ToolResultBlock>
  | AttachmentBlock;
export type ToolUse = z.infer<typeof ToolUseBlock>;
export type ToolResultContent = z.infer<typeof ToolResultBlock>;
export type ApiMessage = { role: 'user' | 'assistant'; content: string | ApiBlock[] };

export type ImageMediaType = 'image/webp' | 'image/jpeg' | 'image/png';
export type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } };
/** Blok wejscia modelu: jak w historii, ale zalaczniki rozwiniete w obrazy i tekst. */
export type ModelBlock = Exclude<ApiBlock, AttachmentBlock> | ImageBlock;
export type ModelMessage = { role: 'user' | 'assistant'; content: string | ModelBlock[] };

export type PageSource = 'pdf' | 'ocr' | 'file';
export interface ResolvedPage {
  text: string;
  source: PageSource;
  /** Obraz strony (base64) - null dla DOCX/TXT, po przekroczeniu budzetu albo bledzie pobrania. */
  image: { mediaType: ImageMediaType; data: string } | null;
}
export interface ResolvedAttachment {
  kind: AttachmentKind;
  name: string;
  pages: ResolvedPage[];
  /** Obrazy stron pominiete z powodu budzetu obrazow na zadanie (model dostaje sam tekst). */
  imagesOmitted: boolean;
}
/** Zalaczniki z bazy dla wejscia modelu i transkrypcji, po id bloku `attachment`. */
export type ResolvedAttachments = Map<string, ResolvedAttachment>;

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  image: 'Obraz',
  pdf: 'PDF',
  docx: 'Dokument Word',
  text: 'Plik tekstowy',
};

export class InvalidHistoryError extends Error {}

export function toolUsesOf(message: ApiMessage): ToolUse[] {
  if (typeof message.content === 'string') return [];
  return message.content.filter((b): b is ToolUse => b.type === 'tool_use');
}

function toolResultIdsOf(message: ApiMessage): Set<string> {
  if (typeof message.content === 'string') return new Set();
  return new Set(
    message.content.filter((b): b is ToolResultContent => b.type === 'tool_result').map((b) => b.tool_use_id),
  );
}

// Brak wyniku = zatwierdzenie pominiete (uzytkownik napisal nowa wiadomosc albo przerwal odpowiedz).
function skippedResult(use: ToolUse): ToolResultContent {
  return {
    type: 'tool_result',
    tool_use_id: use.id,
    content: 'Operacja nie zostala wykonana (brak zatwierdzenia albo przerwanie przez uzytkownika).',
  };
}

/**
 * Sprawdza naprzemiennosc rol i powiazania tool_result -> tool_use, a brakujace wyniki
 * (pominiete zatwierdzenie, przerwana odpowiedz) uzupelnia deterministycznie - przy kazdym
 * zadaniu tak samo, wiec cache promptu i podpisy thinking pozostaja wazne.
 */
export function normalizeHistory(messages: ApiMessage[]): ApiMessage[] {
  if (messages[0]?.role !== 'user') throw new InvalidHistoryError('Rozmowa musi zaczynac sie od wiadomosci uzytkownika.');
  return messages.map((message, i) => {
    if (i > 0 && messages[i - 1].role === message.role) {
      throw new InvalidHistoryError('Wiadomosci uzytkownika i asystenta musza wystepowac naprzemiennie.');
    }
    if (message.role !== 'user') return message;

    const expected = i > 0 ? toolUsesOf(messages[i - 1]) : [];
    const expectedIds = new Set(expected.map((u) => u.id));
    const present = toolResultIdsOf(message);
    for (const id of present) {
      if (!expectedIds.has(id)) throw new InvalidHistoryError('Wynik narzedzia bez odpowiadajacego wywolania.');
    }
    const missing = expected.filter((u) => !present.has(u.id)).map(skippedResult);
    if (missing.length === 0) return message;

    const blocks: ApiBlock[] =
      typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    const results = blocks.filter((b) => b.type === 'tool_result');
    const rest = blocks.filter((b) => b.type !== 'tool_result');
    // Wyniki narzedzi musza poprzedzac tekst w wiadomosci uzytkownika.
    return { role: 'user', content: [...results, ...missing, ...rest] };
  });
}

/** Wiadomosc rozpoczynajaca ture: uzytkownik z tekstem albo z zalacznikiem (jak w kliencie). */
export function isUserPromptMessage(message: ApiMessage): boolean {
  if (message.role !== 'user') return false;
  if (typeof message.content === 'string') return message.content.trim().length > 0;
  return message.content.some((b) => (b.type === 'text' && b.text.trim().length > 0) || b.type === 'attachment');
}

/** Klucz tury = indeks wiadomosci uzytkownika (tekst lub zalacznik), ktora ja rozpoczyna (jak w kliencie). */
export function lastTurnKey(messages: ApiMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isUserPromptMessage(messages[i])) return i;
  }
  return 0;
}

/**
 * Dokleja wiadomosc uzytkownika: zalaczniki, potem tekst (bez zalacznikow - sam tekst jako string).
 * Gdy historia konczy sie wiadomoscia uzytkownika (wyniki narzedzi po przerwaniu albo pytanie bez
 * odpowiedzi po bledzie), bloki trafiaja do niej - role musza sie przeplatac.
 */
export function appendUserMessage(
  messages: ApiMessage[],
  text: string | undefined,
  attachments: AttachmentBlock[],
): ApiMessage[] {
  const added: ApiBlock[] = [...attachments, ...(text ? [{ type: 'text' as const, text }] : [])];
  if (added.length === 0) return messages;
  const last = messages[messages.length - 1];
  if (last?.role !== 'user') {
    return [...messages, { role: 'user', content: attachments.length === 0 && text ? text : added }];
  }
  const blocks: ApiBlock[] = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content;
  return [...messages.slice(0, -1), { role: 'user', content: [...blocks, ...added] }];
}

/** Krotki opis zalacznika do transkrypcji, np. `[Załącznik: pismo.pdf (PDF, 3 str.)]`. */
export function attachmentLabel(block: AttachmentBlock): string {
  return `[Załącznik: ${block.name} (${ATTACHMENT_KIND_LABELS[block.kind]}, ${block.pages} str.)]`;
}

/** Caly tekst zalacznika (strony oddzielone pusta linia). */
export function attachmentText(attachment: ResolvedAttachment): string {
  return attachment.pages
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

const SOURCE_LABELS: Record<PageSource, string> = {
  pdf: 'warstwa tekstowa PDF',
  ocr: 'odczyt OCR',
  file: 'treść pliku',
};

/**
 * Blok `attachment` w wejsciu modelu: naglowek, potem dla kazdej strony obraz i jej tekst
 * ze zrodlem (DOCX/TXT - sama tresc). Brak wiersza w bazie = krotka informacja.
 */
function attachmentModelBlocks(block: AttachmentBlock, attachment: ResolvedAttachment | undefined): ModelBlock[] {
  if (!attachment) return [{ type: 'text', text: `[Załącznik "${block.name}" jest niedostępny]` }];
  const header =
    `Załącznik "${attachment.name}" (${ATTACHMENT_KIND_LABELS[attachment.kind]}, ${attachment.pages.length} str.)` +
    (attachment.imagesOmitted
      ? '\n[Obrazy stron pominięte - limit obrazów w jednym zapytaniu; poniżej tylko tekst]'
      : '');
  if (attachment.kind === 'docx' || attachment.kind === 'text') {
    return [{ type: 'text', text: `${header}\nTreść pliku:\n${attachmentText(attachment) || 'brak tekstu'}` }];
  }
  const blocks: ModelBlock[] = [{ type: 'text', text: header }];
  attachment.pages.forEach((page, i) => {
    if (page.image) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: page.image.mediaType, data: page.image.data } });
    }
    blocks.push({
      type: 'text',
      text: page.text.trim()
        ? `Strona ${i + 1} - tekst (${SOURCE_LABELS[page.source]}):\n${page.text}`
        : `Strona ${i + 1} - brak tekstu`,
    });
  });
  return blocks;
}

function toModelMessage(message: ApiMessage, attachments: ResolvedAttachments): ModelMessage {
  if (typeof message.content === 'string') return { role: message.role, content: message.content };
  return {
    role: message.role,
    content: message.content.flatMap((b): ModelBlock[] =>
      b.type === 'attachment' ? attachmentModelBlocks(b, attachments.get(b.id)) : [b],
    ),
  };
}

/** Indeks pierwszej wiadomosci w wejsciu modelu (0 bez kompresji kontekstu). */
export function contextStart(messages: ApiMessage[], summary: string | null, from: number): number {
  return !summary || from <= 0 || from >= messages.length ? 0 : from;
}

/**
 * Wejscie modelu po kompresji: messages[from:] (zaczyna sie od wiadomosci uzytkownika z tekstem
 * lub zalacznikiem), a streszczenie wczesniejszej czesci doklejone na poczatku pierwszej wiadomosci.
 * Bloki `attachment` rozwiniete z `attachments` (resolveAttachments).
 */
export function modelMessages(
  messages: ApiMessage[],
  summary: string | null,
  from: number,
  attachments: ResolvedAttachments,
): ModelMessage[] {
  const start = contextStart(messages, summary, from);
  const model = messages.slice(start).map((m) => toModelMessage(m, attachments));
  if (start === 0 || !summary) return model;
  const [first, ...rest] = model;
  const blocks: ModelBlock[] =
    typeof first.content === 'string' ? [{ type: 'text', text: first.content }] : first.content;
  const note: ModelBlock = {
    type: 'text',
    text: `[Streszczenie wcześniejszej części tej rozmowy - pełna historia została skrócona]\n${summary}\n[Koniec streszczenia]`,
  };
  return [{ role: 'user', content: [note, ...blocks] }, ...rest];
}

/**
 * Granica kompresji: poczatek przedostatniej tury (zostaja 2 ostatnie tury w pelnej postaci).
 * Null, gdy za malo tur, zeby cokolwiek streszczac.
 */
export function compactionCut(messages: ApiMessage[], from: number): number | null {
  const turnStarts = messages.map((m, i) => (isUserPromptMessage(m) ? i : -1)).filter((i) => i > from);
  if (turnStarts.length < 2) return null;
  return turnStarts[turnStarts.length - 2];
}

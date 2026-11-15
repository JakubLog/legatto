// Pamiec PoliAI:
// 1. W obrebie rozmowy - kompresja: gdy wejscie modelu przekracza COMPACT_AT_TOKENS, starsze tury
//    zastepuje streszczenie (szybki model), a 2 ostatnie tury zostaja w pelnej postaci.
// 2. Miedzy rozmowami - po kazdej zakonczonej turze szybki model aktualizuje tytul (raz) i
//    podsumowanie rozmowy; glowny model czyta podsumowania innych rozmow narzedziem
//    poliai_past_conversations (tylko wlasne rozmowy uzytkownika).

import { z } from 'zod';
import type { McpAuthContext } from '../auth.js';
import { forcedToolCall, type AnthropicTool } from './anthropic.js';
import { attachmentLabel, attachmentText, type ApiMessage, type ResolvedAttachments } from './conversation.js';
import { listPastConversations, type Conversation } from './store.js';

// Okno kontekstu modeli Claude 4.6+/5.x: 200k tokenow; kompresja przy ~80%.
const CONTEXT_WINDOW_TOKENS = 200_000;
export const COMPACT_AT_TOKENS = Math.round(CONTEXT_WINDOW_TOKENS * 0.8);

export const PAST_CONVERSATIONS_TOOL = 'poliai_past_conversations';

export const PAST_CONVERSATIONS_DEF: AnthropicTool = {
  name: PAST_CONVERSATIONS_TOOL,
  description:
    'Przegląda podsumowania poprzednich rozmów użytkownika z PoliAI (tylko jego własnych, ostatnie 90 dni). ' +
    'Użyj, gdy pytanie nawiązuje do wcześniejszych ustaleń ("jak ostatnio", "wracając do..."), albo gdy kontekst ' +
    'z innych rozmów może pomóc. Opcjonalnie fraza do zawężenia. Podsumowania mogą być nieaktualne - fakty sprawdzaj narzędziami.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', maxLength: 100, description: 'Słowo kluczowe do wyszukania w tytułach i podsumowaniach' },
    },
    additionalProperties: false,
  },
};

const PastInput = z.object({ query: z.string().max(100).optional() });

export async function runPastConversations(ctx: McpAuthContext, conversationId: string, input: unknown): Promise<string> {
  const parsed = PastInput.safeParse(input);
  const query = parsed.success ? (parsed.data.query?.trim() ?? null) : null;
  const items = await listPastConversations(ctx, conversationId, query || null, 15);
  if (items.length === 0) {
    return query ? `Brak poprzednich rozmów pasujących do "${query}".` : 'Brak poprzednich rozmów z podsumowaniem.';
  }
  return JSON.stringify(
    items.map((c) => ({ tytul: c.title, ostatnio: c.updated_at.slice(0, 10), podsumowanie: c.summary })),
    null,
    1,
  );
}

/**
 * Pelny wyciag rozmowy dla szybkiego modelu: tekst, zalaczniki (opis i poczatek tekstu),
 * wywolania narzedzi i (skrocone) wyniki.
 */
function transcript(
  messages: ApiMessage[],
  maxResultChars: number,
  attachments: ResolvedAttachments,
  maxAttachmentChars: number,
): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      lines.push(`${m.role === 'user' ? 'Użytkownik' : 'PoliAI'}: ${m.content}`);
      continue;
    }
    for (const b of m.content) {
      if (b.type === 'text' && b.text.trim()) lines.push(`${m.role === 'user' ? 'Użytkownik' : 'PoliAI'}: ${b.text}`);
      else if (b.type === 'tool_use') lines.push(`[narzędzie ${b.name} ${JSON.stringify(b.input)}]`);
      else if (b.type === 'tool_result') lines.push(`[wynik: ${b.content.slice(0, maxResultChars)}]`);
      else if (b.type === 'attachment') {
        const resolved = attachments.get(b.id);
        const text = resolved ? attachmentText(resolved) : '';
        const excerpt = text.length > maxAttachmentChars ? `${text.slice(0, maxAttachmentChars)} [...]` : text;
        lines.push(excerpt ? `${attachmentLabel(b)}\n${excerpt}` : attachmentLabel(b));
      }
    }
  }
  return lines.join('\n');
}

const MemoryOutput = z.object({ title: z.string().trim().min(1).max(120).optional(), summary: z.string().trim().min(1).max(4000) });

const MEMORY_TOOL: AnthropicTool = {
  name: 'save_conversation_memory',
  description: 'Zapisuje tytuł i podsumowanie rozmowy.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Krótki tytuł rozmowy po polsku (3-6 słów), bez kropki' },
      summary: { type: 'string', description: 'Podsumowanie rozmowy (do 120 słów)' },
    },
    required: ['summary'],
  },
};

const MEMORY_SYSTEM = `Tworzysz pamięć rozmów asystenta PoliAI w biurze poselskim. Zapisz narzędziem save_conversation_memory:
- title: krótki tytuł rozmowy po polsku (3-6 słów, bez kropki), opisujący temat, np. "Zaległe sprawy w Barczewie".
- summary: zwięzłe podsumowanie do 120 słów: czego użytkownik szukał, kluczowe ustalenia i fakty (nazwy spraw, osoby, daty, decyzje), wykonane operacje i otwarte wątki. Bez ogólników.`;

export interface MemoryRequest {
  apiKey: string;
  model: string;
  signal: AbortSignal;
}

export async function summarizeConversation(
  req: MemoryRequest,
  conversation: Conversation,
  attachments: ResolvedAttachments,
): Promise<{ title: string | null; summary: string }> {
  const input = await forcedToolCall({
    ...req,
    maxTokens: 800,
    tool: MEMORY_TOOL,
    system: MEMORY_SYSTEM,
    prompt:
      (conversation.contextSummary ? `Streszczenie wcześniejszej części:\n${conversation.contextSummary}\n\n` : '') +
      `Rozmowa:\n${transcript(conversation.messages.slice(conversation.contextFrom), 800, attachments, 800).slice(-60_000)}`,
  });
  const parsed = MemoryOutput.parse(input);
  return { title: parsed.title ?? null, summary: parsed.summary };
}

const CompactOutput = z.object({ summary: z.string().trim().min(1).max(20_000) });

const COMPACT_TOOL: AnthropicTool = {
  name: 'save_context_summary',
  description: 'Zapisuje streszczenie wcześniejszej części rozmowy.',
  input_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
};

const COMPACT_SYSTEM = `Streszczasz wcześniejszą część rozmowy asystenta PoliAI z użytkownikiem biura poselskiego, żeby asystent mógł ją kontynuować bez pełnej historii.
Zachowaj wszystko, co może być potrzebne dalej: prośby użytkownika, ustalenia, fakty z narzędzi (nazwy, liczby, daty, statusy) wraz z identyfikatorami rekordów (UUID) i linkami, kluczowe treści załączników użytkownika (nazwa pliku i najważniejsze dane z niego), wykonane i odrzucone operacje, otwarte wątki.
Pomiń powtórzenia i dane nieistotne. Pisz po polsku, punktami, maks. ok. 1500 słów. Zapisz narzędziem save_context_summary.`;

/** Streszczenie messages[from:cut] (wraz z poprzednim streszczeniem) - wynik zastepuje te tury w wejsciu modelu. */
export async function compactContext(
  req: MemoryRequest,
  conversation: Conversation,
  cut: number,
  attachments: ResolvedAttachments,
): Promise<string> {
  const input = await forcedToolCall({
    ...req,
    maxTokens: 4000,
    tool: COMPACT_TOOL,
    system: COMPACT_SYSTEM,
    prompt:
      (conversation.contextSummary ? `Dotychczasowe streszczenie:\n${conversation.contextSummary}\n\n` : '') +
      `Dalsza część rozmowy do streszczenia:\n${transcript(conversation.messages.slice(conversation.contextFrom, cut), 3000, attachments, 4000).slice(-300_000)}`,
  });
  return CompactOutput.parse(input).summary;
}

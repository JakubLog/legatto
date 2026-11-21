// Klient Anthropic Messages API dla PoliAI: streaming SSE na fetch (bez SDK).
// Skladamy pelna wiadomosc asystenta z delt i przekazujemy przyrosty do UI przez onEvent.

import { z } from 'zod';
import type { ApiBlock, ImageMediaType, ModelBlock, ModelMessage } from './conversation.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models?limit=100';
const ANTHROPIC_VERSION = '2023-06-01';
// Domyslne modele, gdy nie ustawil ich operator (AI_MODEL, AI_FAST_MODEL) ani panel (ai_model).
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
// Szybki model: wstep, przyciski kolejnych krokow, pamiec, kompresja kontekstu, OCR zalacznikow.
export const DEFAULT_FAST_MODEL = 'claude-haiku-5-5';

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ModelRequest {
  apiKey: string;
  model: string;
  system: { stable: string; context: string };
  tools: AnthropicTool[];
  messages: ModelMessage[];
  maxTokens: number;
  signal: AbortSignal;
}

export type StreamEvent =
  | { type: 'block_start'; index: number; block: { type: 'thinking' | 'text' | 'tool_use'; id?: string; name?: string } }
  | { type: 'block_delta'; index: number; text: string };

export interface ModelResponse {
  content: ApiBlock[];
  stopReason: string;
  /** Rozmiar wejscia (z cache) - podstawa decyzji o kompresji kontekstu. */
  inputTokens: number;
}

export class AnthropicApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AnthropicApiError';
    this.status = status;
    this.code = code;
  }
}

/** Tlumaczy blad Anthropic API na komunikat dla uzytkownika + kod do obslugi w UI. */
export function describeAnthropicError(status: number, rawMessage: string): AnthropicApiError {
  const message = rawMessage.toLowerCase();
  if (status === 401) return new AnthropicApiError(status, 'AI_KEY_INVALID', 'Klucz API Claude jest nieprawidłowy lub został usunięty.');
  if (status === 403) return new AnthropicApiError(status, 'AI_KEY_FORBIDDEN', 'Klucz API Claude nie ma dostępu do tego zasobu.');
  if (message.includes('credit balance')) {
    return new AnthropicApiError(
      status,
      'AI_NO_CREDITS',
      'Wyczerpano kredyty API w organizacji Claude Console. Kredyty z planu Max odnawiają się co miesiąc.',
    );
  }
  if (status === 404) {
    return new AnthropicApiError(status, 'AI_MODEL_NOT_FOUND', 'Wybrany model Claude nie jest dostępny. Zmień model w ustawieniach AI.');
  }
  if (status === 429) return new AnthropicApiError(status, 'AI_RATE_LIMIT', 'Przekroczono limit zapytań do Claude. Spróbuj za chwilę.');
  if (message.includes('prompt is too long') || message.includes('context window')) {
    return new AnthropicApiError(status, 'POLIAI_TOO_LONG', 'Rozmowa jest za długa dla modelu. Zacznij nową rozmowę.');
  }
  return new AnthropicApiError(status, 'AI_UPSTREAM', 'Usługa AI jest tymczasowo niedostępna. Spróbuj ponownie za chwilę.');
}

// Modele sprzed Claude 4.6 nie znaja adaptive thinking - tam reczny budzet (extended thinking).
const LEGACY_THINKING_MODEL = /(?:^|-)(?:3-[57]|4-[015])(?:-|$)|-4-\d{8}$/;

function thinkingConfig(model: string): Record<string, unknown> {
  if (LEGACY_THINKING_MODEL.test(model)) return { type: 'enabled', budget_tokens: 4000 };
  return { type: 'adaptive', display: 'summarized' };
}

function errorMessageOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    return typeof parsed.error?.message === 'string' ? parsed.error.message : body;
  } catch {
    return body;
  }
}

const ModelList = z.object({
  data: z.array(z.object({ id: z.string(), display_name: z.string().optional() })),
});

export interface AnthropicModel {
  id: string;
  display_name: string;
}

/** GET /v1/models - weryfikuje klucz i zwraca modele dostepne dla niego. Blad = AnthropicApiError. */
export async function listModels(apiKey: string, signal: AbortSignal): Promise<AnthropicModel[]> {
  const res = await fetch(ANTHROPIC_MODELS_URL, {
    signal,
    headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw describeAnthropicError(res.status, errorMessageOf(JSON.stringify(body)));
  const list = ModelList.safeParse(body);
  return list.success ? list.data.data.map((m) => ({ id: m.id, display_name: m.display_name ?? m.id })) : [];
}

interface DraftBlock {
  type: 'text' | 'thinking' | 'redacted_thinking' | 'tool_use';
  text: string;
  signature: string;
  data: string;
  id: string;
  name: string;
  json: string;
}

// Zdarzenia strumienia Anthropic - tylko pola, z ktorych korzystamy.
const EventType = z.object({ type: z.string() });
const DraftBlockType = z.enum(['text', 'thinking', 'redacted_thinking', 'tool_use']);
const BlockStart = z.object({
  index: z.number().int().nonnegative(),
  content_block: z.object({
    type: z.string(),
    text: z.string().optional(),
    thinking: z.string().optional(),
    signature: z.string().optional(),
    data: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
  }),
});
const BlockDelta = z.object({
  index: z.number().int().nonnegative(),
  delta: z.object({
    type: z.string(),
    text: z.string().optional(),
    thinking: z.string().optional(),
    signature: z.string().optional(),
    partial_json: z.string().optional(),
  }),
});
const MessageDelta = z.object({ delta: z.object({ stop_reason: z.string().nullable().optional() }) });
const MessageStart = z.object({
  message: z.object({
    usage: z.object({
      input_tokens: z.number(),
      cache_creation_input_tokens: z.number().nullable().optional(),
      cache_read_input_tokens: z.number().nullable().optional(),
    }),
  }),
});
const StreamError = z.object({ error: z.object({ type: z.string().optional(), message: z.string().optional() }) });

function finalizeBlock(b: DraftBlock): ApiBlock | null {
  switch (b.type) {
    case 'text':
      return b.text ? { type: 'text', text: b.text } : null;
    case 'thinking':
      return { type: 'thinking', thinking: b.text, signature: b.signature };
    case 'redacted_thinking':
      return { type: 'redacted_thinking', data: b.data };
    case 'tool_use': {
      // Ucieta odpowiedz (max_tokens) moze zostawic niepelny JSON - wtedy pusty input.
      let input: Record<string, unknown> = {};
      try {
        const parsed: unknown = b.json.trim() ? JSON.parse(b.json) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
      } catch {
        input = {};
      }
      return { type: 'tool_use', id: b.id, name: b.name, input };
    }
  }
}

/** Jedno wywolanie modelu ze streamingiem. Zwraca zlozona wiadomosc i stop_reason. */
export async function streamModel(req: ModelRequest, onEvent: (e: StreamEvent) => void): Promise<ModelResponse> {
  const lastMessage = req.messages.length - 1;
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'x-api-key': req.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      stream: true,
      thinking: thinkingConfig(req.model),
      // Cache: narzedzia + stala czesc systemu oraz prefiks historii do ostatniej wiadomosci.
      system: [
        { type: 'text', text: req.system.stable, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: req.system.context },
      ],
      tools: req.tools,
      messages: req.messages.map((m, i) => (i === lastMessage ? withCacheBreakpoint(m) : m)),
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    console.error('[poliai] Anthropic API error', res.status, body.slice(0, 500));
    throw describeAnthropicError(res.status, errorMessageOf(body));
  }

  const blocks = new Map<number, DraftBlock>();
  let stopReason = 'end_turn';
  let inputTokens = 0;

  const handle = (raw: unknown) => {
    const { type } = EventType.parse(raw);
    switch (type) {
      case 'message_start': {
        const usage = MessageStart.safeParse(raw);
        if (usage.success) {
          const u = usage.data.message.usage;
          inputTokens = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        }
        return;
      }
      case 'content_block_start': {
        const { index, content_block: cb } = BlockStart.parse(raw);
        const blockType = DraftBlockType.safeParse(cb.type);
        // Inne typy blokow (np. narzedzia serwerowe) nie sa uzywane przez PoliAI.
        if (!blockType.success) return;
        blocks.set(index, {
          type: blockType.data,
          text: cb.text ?? cb.thinking ?? '',
          signature: cb.signature ?? '',
          data: cb.data ?? '',
          id: cb.id ?? '',
          name: cb.name ?? '',
          json: '',
        });
        if (blockType.data === 'tool_use') {
          onEvent({ type: 'block_start', index, block: { type: 'tool_use', id: cb.id ?? '', name: cb.name ?? '' } });
        } else if (blockType.data !== 'redacted_thinking') {
          onEvent({ type: 'block_start', index, block: { type: blockType.data } });
        }
        return;
      }
      case 'content_block_delta': {
        const { index, delta } = BlockDelta.parse(raw);
        const block = blocks.get(index);
        if (!block) return;
        if (delta.type === 'text_delta' && delta.text !== undefined) {
          block.text += delta.text;
          onEvent({ type: 'block_delta', index, text: delta.text });
        } else if (delta.type === 'thinking_delta' && delta.thinking !== undefined) {
          block.text += delta.thinking;
          if (delta.thinking) onEvent({ type: 'block_delta', index, text: delta.thinking });
        } else if (delta.type === 'signature_delta' && delta.signature !== undefined) {
          block.signature += delta.signature;
        } else if (delta.type === 'input_json_delta' && delta.partial_json !== undefined) {
          block.json += delta.partial_json;
        }
        return;
      }
      case 'message_delta': {
        const { delta } = MessageDelta.parse(raw);
        if (delta.stop_reason) stopReason = delta.stop_reason;
        return;
      }
      case 'error': {
        const { error } = StreamError.parse(raw);
        console.error('[poliai] Anthropic stream error', error);
        throw describeAnthropicError(error.type === 'overloaded_error' ? 529 : 500, error.message ?? '');
      }
    }
  };

  await forEachSseEvent(res.body, handle);

  const content = [...blocks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, b]) => finalizeBlock(b))
    .filter((b): b is ApiBlock => b !== null);
  return { content, stopReason, inputTokens };
}

async function forEachSseEvent(body: ReadableStream<Uint8Array>, handle: (event: unknown) => void): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) handle(JSON.parse(data));
    }
  }
}

export interface IntroRequest {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  signal: AbortSignal;
}

/**
 * Krotki wstep szybkim modelem (bez myslenia i narzedzi), rownolegle z glownym wywolaniem.
 * Strumieniuje przyrosty tekstu; zwraca pelny tekst.
 */
export async function streamIntro(req: IntroRequest, onDelta: (text: string) => void): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    signal: req.signal,
    headers: { 'x-api-key': req.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: req.model,
      max_tokens: 200,
      stream: true,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw describeAnthropicError(res.status, errorMessageOf(body));
  }
  let text = '';
  await forEachSseEvent(res.body, (raw) => {
    const { type } = EventType.parse(raw);
    if (type !== 'content_block_delta') return;
    const { delta } = BlockDelta.parse(raw);
    if (delta.type === 'text_delta' && delta.text) {
      text += delta.text;
      onDelta(delta.text);
    }
  });
  return text;
}

export interface SuggestedAction {
  label: string;
  prompt?: string;
  href?: string;
}

const ForcedToolResponse = z.object({
  content: z.array(z.object({ type: z.string(), name: z.string().optional(), input: z.unknown().optional() })),
});

export interface ForcedToolRequest extends IntroRequest {
  maxTokens: number;
  tool: AnthropicTool;
}

/**
 * Strukturalne wyjscie szybkiego modelu: wymuszone wywolanie jednego narzedzia, zwraca jego input
 * (do walidacji przez wolajacego). Bez myslenia i strumieniowania.
 */
export async function forcedToolCall(req: ForcedToolRequest): Promise<unknown> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    signal: req.signal,
    headers: { 'x-api-key': req.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      system: req.system,
      tools: [req.tool],
      tool_choice: { type: 'tool', name: req.tool.name },
      messages: [{ role: 'user', content: req.prompt }],
    }),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw describeAnthropicError(res.status, errorMessageOf(JSON.stringify(body)));
  return ForcedToolResponse.parse(body).content.find((b) => b.type === 'tool_use' && b.name === req.tool.name)?.input;
}

const StructuredResponse = z.object({
  stop_reason: z.string().nullable().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

export interface StructuredRequest extends IntroRequest {
  maxTokens: number;
  /** JSON Schema structured outputs: additionalProperties false, bez maxItems/minimum. */
  schema: Record<string, unknown>;
  effort: 'low' | 'medium' | 'high';
}

export interface StructuredResult {
  /** Sparsowany JSON odpowiedzi; null gdy brak tekstu albo niepoprawny JSON (np. ucieta odpowiedz). */
  value: unknown;
  stopReason: string | null;
}

/**
 * Odpowiedz glownego modelu jako JSON wg schematu (structured outputs, `output_config.format`).
 * Bez narzedzi i bez parametru thinking: nowsze modele (np. claude-sonnet-5-5) odrzucaja
 * wymuszony tool_choice i thinking "disabled", wiec myslenie zostaje domyslne dla modelu.
 */
export async function structuredOutput(req: StructuredRequest): Promise<StructuredResult> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    signal: req.signal,
    headers: { 'x-api-key': req.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      output_config: { effort: req.effort, format: { type: 'json_schema', schema: req.schema } },
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
    }),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw describeAnthropicError(res.status, errorMessageOf(JSON.stringify(body)));
  const parsed = StructuredResponse.parse(body);
  const text = parsed.content.map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('');
  let value: unknown = null;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = null;
  }
  return { value, stopReason: parsed.stop_reason ?? null };
}

const SuggestInput = z.object({
  actions: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        prompt: z.string().trim().min(1).max(500).optional(),
        href: z.string().max(300).optional(),
      }),
    )
    .max(6),
});

const SUGGEST_TOOL: AnthropicTool = {
  name: 'suggest_next_steps',
  description: 'Zapisuje 2-4 proponowane kolejne kroki dla użytkownika.',
  input_schema: {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Krótka etykieta przycisku (do 40 znaków)' },
            prompt: { type: 'string', description: 'Polecenie w 1. osobie, jakby pisał je użytkownik' },
            href: { type: 'string', description: 'Ścieżka ekranu zaczynająca się od /biuro (zamiast prompt)' },
          },
          required: ['label'],
        },
      },
    },
    required: ['actions'],
  },
};

/** Propozycje kolejnych krokow po odpowiedzi. href tylko wewnatrz aplikacji (/biuro), maks. 4. */
export async function suggestActions(req: IntroRequest): Promise<SuggestedAction[]> {
  const parsed = SuggestInput.safeParse(await forcedToolCall({ ...req, maxTokens: 600, tool: SUGGEST_TOOL }));
  if (!parsed.success) return [];
  return parsed.data.actions
    .map(({ label, prompt, href }) => ({
      label,
      ...(prompt ? { prompt } : {}),
      ...(!prompt && href?.startsWith('/biuro') ? { href } : {}),
    }))
    .filter((a) => a.prompt || a.href)
    .slice(0, 4);
}

const MessageResponse = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

export interface OcrRequest {
  apiKey: string;
  model: string;
  system: string;
  image: { mediaType: ImageMediaType; data: string };
  maxTokens: number;
  signal: AbortSignal;
}

/** Odczyt tekstu z obrazu szybkim modelem (bez myslenia i strumieniowania). Zwraca tekst odpowiedzi. */
export async function ocrImage(req: OcrRequest): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    signal: req.signal,
    headers: { 'x-api-key': req.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      thinking: { type: 'disabled' },
      system: req.system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: req.image.mediaType, data: req.image.data } },
            { type: 'text', text: 'Przepisz tekst z tego obrazu.' },
          ],
        },
      ],
    }),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw describeAnthropicError(res.status, errorMessageOf(JSON.stringify(body)));
  return MessageResponse.parse(body)
    .content.map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
    .join('')
    .trim();
}

function withCacheBreakpoint(message: ModelMessage): Record<string, unknown> {
  const content: ModelBlock[] =
    typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
  const lastCacheable = content.findLastIndex((b) => b.type === 'text' || b.type === 'tool_result');
  if (lastCacheable === -1) return message as unknown as Record<string, unknown>;
  return {
    role: message.role,
    content: content.map((b, i) => (i === lastCacheable ? { ...b, cache_control: { type: 'ephemeral' } } : b)),
  };
}

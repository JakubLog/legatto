// POST /api/poliai - PoliAI, asystent AI w aplikacji (panel z prawej strony).
//
// Sesja Supabase (Bearer access_token, aal2) -> kontekst jak w MCP (rola, zakres danych),
// model Claude z kluczem i modelem z env operatora albo Integracje -> AI, narzedzia z rejestru MCP
// (api/_lib/tools). Odpowiedz to strumien SSE (kontrakt: ai-lib/plans/2026-10-25-poliai.md).
//
// Historia rozmowy jest w bazie (poliai_conversations) - klient wysyla conversation_id i nowa
// wiadomosc albo decyzje. Narzedzia odczytu wykonuja sie od razu, narzedzia zapisu dopiero po
// decyzji uzytkownika (approvals). Kazde zadanie jest audytowane (poliai.request) i liczone do
// dziennego limitu; kazde wywolanie narzedzia - mcp.tool_call z via=poliai.
//
// Obok glownego modelu szybki model (AiSettings.fastModel) pisze wstep, przyciski kolejnych krokow,
// tytul i podsumowanie rozmowy (pamiec miedzy chatami) oraz streszczenie przy kompresji kontekstu.
//
// POST /api/poliai?op=attachment - przygotowanie zalacznika (walidacja plikow w buckecie, OCR,
// zapis wiersza; api/_lib/poliai/attachments.ts). Kontrakt: ai-lib/plans/2026-10-26-poliai-zalaczniki.md.
//
// POST /api/poliai?op=budget-report - raport AI budzetu biura za miesiac (analityka z bazy,
// wymuszone narzedzie glownego modelu, zapis w budget_reports; api/_lib/poliai/budget-report.ts).
// Kontrakt: ai-lib/plans/2026-10-26-budzet-analityka-raporty-ai.md.
//
// POST /api/poliai?op=connection - weryfikacja klucza (GET /v1/models) i lista modeli dla
// Integracje -> AI; tylko Posel i Administrator. Odpowiedz JSON, bledy Anthropic jako ok: false.
//
// INSTANCE_AI != on: kazda operacja = 404 AI_DISABLED, zanim dotkniemy sesji, bazy i sekretow.
//
// Operacje w tej samej funkcji, bo Vercel Hobby ma limit liczby funkcji.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isPoselRole, type McpAuthContext } from './_lib/auth.js';
import { logAudit } from './_lib/audit.js';
import { operatorAi, rejectIfAiDisabled } from './_lib/instance.js';
import { getSiteIdentity, mpForms } from './_lib/siteIdentity.js';
import { callTool, getTool } from './_lib/tools/index.js';
import {
  appendUserMessage,
  compactionCut,
  contextStart,
  InvalidHistoryError,
  lastTurnKey,
  modelMessages,
  normalizeHistory,
  RequestSchema,
  toolUsesOf,
  type ApiBlock,
  type ApiMessage,
  type ResolvedAttachments,
  type ToolUse,
} from './_lib/poliai/conversation.js';
import {
  AnthropicApiError,
  describeAnthropicError,
  listModels,
  streamIntro,
  streamModel,
  suggestActions,
  type StreamEvent,
  type SuggestedAction,
} from './_lib/poliai/anthropic.js';
import {
  buildIntroPrompt,
  buildSuggestPrompt,
  buildSystemPrompt,
  buildTools,
  INTRO_SYSTEM,
  SUGGEST_SYSTEM,
} from './_lib/poliai/prompt.js';
import {
  COMPACT_AT_TOKENS,
  compactContext,
  PAST_CONVERSATIONS_TOOL,
  runPastConversations,
  summarizeConversation,
} from './_lib/poliai/memory.js';
import {
  ConversationNotFoundError,
  newConversation,
  loadConversation,
  saveConversation,
  type Conversation,
} from './_lib/poliai/store.js';
import { authenticate, enforceDailyLimit, HttpError, requireAiSettings, type AiSettings } from './_lib/poliai/session.js';
import { bindAttachments, claimAttachments, prepareAttachment, resolveAttachments } from './_lib/poliai/attachments.js';
import { generateBudgetReport } from './_lib/poliai/budget-report.js';

const MAX_BODY_BYTES = 64 * 1024;
// Przygotowanie zalacznika: tekst stron (maks. 150 000 znakow) - obrazy ida prosto do bucketu.
const MAX_ATTACHMENT_BODY_BYTES = 1024 * 1024;
const MAX_BUDGET_REPORT_BODY_BYTES = 1024;
const CONNECTION_TIMEOUT_MS = 15_000;
const DAILY_REQUEST_LIMIT = 300;
const REQUEST_LIMIT = {
  action: 'poliai.request',
  limit: DAILY_REQUEST_LIMIT,
  code: 'POLIAI_DAILY_LIMIT',
  message: `Wykorzystano dzienny limit PoliAI (${DAILY_REQUEST_LIMIT} zapytań / 24 h). Spróbuj później.`,
};
const MAX_MODEL_CALLS = 8;
// Po tym czasie nie zaczynamy kolejnego wywolania modelu - klient dostaje `continue`
// i wysyla nastepne zadanie (zapas do maxDuration funkcji w vercel.json).
const TIME_BUDGET_MS = 150_000;
const MAX_OUTPUT_TOKENS = 16_000;
const MAX_TOOL_RESULT_CHARS = 24_000;

type PoliEvent =
  | StreamEvent
  | { type: 'conversation'; id: string; title: string | null }
  | { type: 'assistant_start' }
  | { type: 'intro_delta'; text: string }
  | { type: 'intro_done' }
  | { type: 'suggestions'; actions: SuggestedAction[] }
  | { type: 'assistant_message'; message: ApiMessage }
  | { type: 'tool_running'; id: string; name: string }
  | { type: 'tool_results'; message: ApiMessage }
  | { type: 'approval_required'; ids: string[] }
  | { type: 'continue' }
  | { type: 'done'; stop_reason: string }
  | { type: 'title'; title: string }
  | { type: 'compacted'; context_from: number }
  | { type: 'error'; error: string; code?: string };

type Send = (e: PoliEvent) => void;

function needsApproval(use: ToolUse): boolean {
  const tool = getTool(use.name, 'poliai');
  return Boolean(tool && !tool.readOnly);
}

function textOf(message: ApiMessage): string {
  if (typeof message.content === 'string') return message.content.trim();
  return message.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
    .trim();
}

function resultText(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[...wynik przyciety - zawez zapytanie filtrami lub limitem]`;
}

async function executeToolUses(
  uses: ToolUse[],
  approvals: Record<string, boolean>,
  ctx: McpAuthContext,
  conversationId: string,
  send: Send,
): Promise<ApiMessage> {
  const results = await Promise.all(
    uses.map(async (use): Promise<ApiBlock> => {
      const result = (content: string, isError = false): ApiBlock => ({
        type: 'tool_result',
        tool_use_id: use.id,
        content,
        ...(isError ? { is_error: true } : {}),
      });
      if (use.name === PAST_CONVERSATIONS_TOOL) {
        send({ type: 'tool_running', id: use.id, name: use.name });
        await logAudit(ctx, 'poliai.memory_read', { metadata: { tool: use.name } });
        return result(await runPastConversations(ctx, conversationId, use.input));
      }
      const tool = getTool(use.name, ctx.channel);
      if (!tool) return result(`Nieznane narzedzie: ${use.name}`, true);
      if (!tool.readOnly && approvals[use.id] !== true) {
        await logAudit(ctx, 'poliai.tool_rejected', { metadata: { tool: tool.name } });
        return result('Uzytkownik odrzucil te operacje - nie zostala wykonana.');
      }
      send({ type: 'tool_running', id: use.id, name: use.name });
      const out = await callTool(tool, use.input, ctx);
      return result(resultText(out.content.map((c) => c.text).join('\n')), out.isError === true);
    }),
  );
  return { role: 'user', content: results };
}

/** Wstep nigdy nie przerywa odpowiedzi - blad tylko w logach, UI pokazuje sama odpowiedz. */
async function runIntro(settings: AiSettings, messages: ApiMessage[], signal: AbortSignal, send: Send): Promise<string> {
  let text = '';
  try {
    await streamIntro(
      {
        apiKey: settings.apiKey,
        model: settings.fastModel,
        system: INTRO_SYSTEM,
        prompt: buildIntroPrompt(messages),
        signal,
      },
      (delta) => {
        text += delta;
        send({ type: 'intro_delta', text: delta });
      },
    );
  } catch (err) {
    if (!signal.aborted) console.warn('[poliai] intro failed', err instanceof Error ? err.message : err);
  } finally {
    // Klient wstrzymuje kafelek pracy i odpowiedz do konca wstepu (kaskada) - takze po bledzie.
    send({ type: 'intro_done' });
  }
  return text;
}

/**
 * Po zakonczonej odpowiedzi: przyciski kolejnych krokow, tytul i podsumowanie rozmowy (pamiec
 * miedzy chatami), kompresja kontekstu blisko limitu. Bledy tylko w logach - odpowiedz juz jest.
 */
async function afterTurn(
  conversation: Conversation,
  attachments: ResolvedAttachments,
  turnKey: number,
  lastInputTokens: number,
  settings: AiSettings,
  signal: AbortSignal,
  send: Send,
): Promise<void> {
  const fast = { apiKey: settings.apiKey, model: settings.fastModel, signal };
  const warn = (what: string) => (err: unknown) => {
    if (!signal.aborted) console.warn(`[poliai] ${what} failed`, err instanceof Error ? err.message : err);
  };

  const suggestions = suggestActions({
    ...fast,
    system: SUGGEST_SYSTEM,
    prompt: buildSuggestPrompt(conversation.messages),
  })
    .then((actions) => {
      if (actions.length === 0) return;
      const key = String(turnKey);
      conversation.extras[key] = { intro: conversation.extras[key]?.intro ?? '', actions };
      send({ type: 'suggestions', actions });
    })
    .catch(warn('suggestions'));

  const memory = summarizeConversation(fast, conversation, attachments)
    .then(({ title, summary }) => {
      conversation.summary = summary;
      if (!conversation.title && title) {
        conversation.title = title;
        send({ type: 'title', title });
      }
    })
    .catch(warn('memory'));

  const compaction = (async () => {
    if (lastInputTokens < COMPACT_AT_TOKENS) return;
    const cut = compactionCut(conversation.messages, conversation.contextFrom);
    if (cut === null) return;
    conversation.contextSummary = await compactContext(fast, conversation, cut, attachments);
    conversation.contextFrom = cut;
    send({ type: 'compacted', context_from: cut });
  })().catch(warn('compaction'));

  await Promise.all([suggestions, memory, compaction]);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handlerInner(req, res).catch((err) => {
    console.error('[poliai] unhandled crash', err);
    if (res.headersSent) {
      try {
        res.end();
      } catch {
        /* polaczenie juz zamkniete */
      }
      return;
    }
    res.status(500).json({ error: 'Wystąpił nieoczekiwany błąd PoliAI.' });
  });
}

/** POST /api/poliai?op=attachment - przygotowanie zalacznika; odpowiedz JSON (bez strumienia). */
async function handleAttachment(req: VercelRequest, res: VercelResponse) {
  if (Number(req.headers['content-length'] ?? 0) > MAX_ATTACHMENT_BODY_BYTES) {
    return res.status(413).json({ error: 'Tekst załącznika jest za długi.' });
  }
  try {
    const ctx = await authenticate(req);
    const settings = await requireAiSettings();
    return res.status(200).json(await prepareAttachment(ctx, settings, req.body));
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    throw err;
  }
}

/** POST /api/poliai?op=budget-report - raport AI budzetu za miesiac; odpowiedz JSON `{ report }`. */
async function handleBudgetReport(req: VercelRequest, res: VercelResponse) {
  if (Number(req.headers['content-length'] ?? 0) > MAX_BUDGET_REPORT_BODY_BYTES) {
    return res.status(413).json({ error: 'Żądanie jest za duże.' });
  }
  try {
    const ctx = await authenticate(req);
    const settings = await requireAiSettings();
    return res.status(200).json(await generateBudgetReport(ctx, settings, req.body));
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    throw err;
  }
}

/**
 * POST /api/poliai?op=connection - klucz (GET /v1/models) i lista modeli; tylko Posel i Administrator.
 * Brak klucza i bledy Anthropic jako 200 `{ ok: false, code }` - UI pokazuje stan, nie wyjatek.
 * `operator_managed`: klucz / model z env operatora (panel ich nie zmienia). Klucz operatora blokuje
 * tez model (AI_MODEL albo domyslny) - patrz requireAiSettings.
 */
async function handleConnection(req: VercelRequest, res: VercelResponse) {
  const operator = operatorAi();
  const operatorManaged = { key: operator.apiKey !== null, model: operator.model !== null || operator.apiKey !== null };
  try {
    const ctx = await authenticate(req);
    if (!isPoselRole(ctx.userRole)) {
      const mp = mpForms((await getSiteIdentity()).mp_gender);
      throw new HttpError(403, `Sprawdzenie połączenia AI jest dostępne dla ${mp.genitive} i Administratora`);
    }
    const settings = await requireAiSettings();
    const models = await listModels(settings.apiKey, AbortSignal.timeout(CONNECTION_TIMEOUT_MS)).catch((err: unknown) => {
      if (err instanceof AnthropicApiError) throw err;
      // Timeout albo blad sieci - jak niedostepna usluga.
      console.warn('[poliai] connection check failed', err instanceof Error ? err.message : err);
      throw describeAnthropicError(503, '');
    });
    return res.status(200).json({
      ok: true,
      model: settings.model,
      model_available: models.some((m) => m.id === settings.model),
      models,
      operator_managed: operatorManaged,
    });
  } catch (err) {
    if (err instanceof AnthropicApiError || (err instanceof HttpError && err.code === 'AI_NOT_CONFIGURED')) {
      return res
        .status(200)
        .json({ ok: false, status: err.status, code: err.code, error: err.message, operator_managed: operatorManaged });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    throw err;
  }
}

async function handlerInner(req: VercelRequest, res: VercelResponse) {
  if (rejectIfAiDisabled(res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Wymagana metoda POST' });
  // req.url zamiast req.query - adapter w vite.config.ts (pnpm dev) nie ustawia query.
  const op = new URL(req.url ?? '', 'http://localhost').searchParams.get('op');
  if (op === 'attachment') return handleAttachment(req, res);
  if (op === 'budget-report') return handleBudgetReport(req, res);
  if (op === 'connection') return handleConnection(req, res);
  if (op !== null) return res.status(400).json({ error: 'Nieznana operacja PoliAI' });
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Wiadomość jest za długa.' });
  }

  let ctx: McpAuthContext;
  let conversation: Conversation;
  let approvals: Record<string, boolean>;
  let page: string | undefined;
  let settings: AiSettings;
  let newMessage: boolean;
  try {
    ctx = await authenticate(req);
    const parsed = RequestSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Nieprawidłowe żądanie PoliAI');
    const body = parsed.data;
    const attachmentIds = body.attachment_ids ?? [];
    approvals = body.approvals ?? {};
    page = body.page;
    newMessage = body.message !== undefined || attachmentIds.length > 0;

    settings = await requireAiSettings();

    if (!body.conversation_id && !newMessage) throw new HttpError(400, 'Brak wiadomości');
    conversation = body.conversation_id ? await loadConversation(ctx, body.conversation_id) : newConversation();
    const attachments = await claimAttachments(ctx, attachmentIds);
    let messages = conversation.messages;
    if (newMessage) messages = appendUserMessage(messages, body.message, attachments);
    if (messages.length === 0) throw new HttpError(400, 'Brak wiadomości');
    messages = normalizeHistory(messages);
    const last = messages[messages.length - 1];
    if (last.role === 'assistant' && toolUsesOf(last).length === 0) {
      throw new HttpError(400, 'Brak nowej wiadomości do wysłania');
    }
    conversation.messages = messages;

    const kind = newMessage ? 'message' : last.role === 'assistant' ? 'approval' : 'continue';
    await enforceDailyLimit(ctx, REQUEST_LIMIT, {
      model: settings.model,
      kind,
      conversation_id: conversation.id,
      ...(attachments.length > 0 ? { attachments: attachments.length } : {}),
    });
    // Pytanie zapisane przed odpowiedzia - zostaje w historii takze po bledzie modelu.
    // Zalaczniki przypiete dopiero po zapisie (klucz obcy do rozmowy).
    if (newMessage) {
      await saveConversation(ctx, conversation);
      await bindAttachments(ctx, attachmentIds, conversation.id);
    }
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err instanceof ConversationNotFoundError) {
      return res.status(404).json({ error: err.message, code: 'POLIAI_CONVERSATION_NOT_FOUND' });
    }
    if (err instanceof InvalidHistoryError) return res.status(400).json({ error: err.message });
    throw err;
  }

  // --- Strumien SSE ---
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const abort = new AbortController();
  let finished = false;
  res.on('close', () => {
    if (!finished) abort.abort();
  });
  const send: Send = (event) => {
    if (!abort.signal.aborted) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const messages = conversation.messages;
  const started = Date.now();
  const system = await buildSystemPrompt(ctx, page);
  const tools = buildTools(ctx);
  const turnKey = lastTurnKey(messages);
  send({ type: 'conversation', id: conversation.id, title: conversation.title });

  // Nowa wiadomosc: szybki model pisze wstep, a glowny model w tym czasie mysli i wola narzedzia.
  const intro = newMessage
    ? runIntro(settings, messages, abort.signal, send).then((text) => {
        if (text) conversation.extras[String(turnKey)] = { intro: text, actions: [] };
      })
    : null;

  try {
    // Kontynuacja po zatwierdzeniu: wykonaj wywolania z ostatniej wiadomosci asystenta.
    const last = messages[messages.length - 1];
    if (last.role === 'assistant') {
      const uses = toolUsesOf(last);
      const pending = uses.filter((u) => needsApproval(u) && approvals[u.id] === undefined);
      if (pending.length > 0) {
        send({ type: 'approval_required', ids: pending.map((u) => u.id) });
        return;
      }
      const results = await executeToolUses(uses, approvals, ctx, conversation.id, send);
      messages.push(results);
      send({ type: 'tool_results', message: results });
    }

    // Zalaczniki z wejscia modelu (wiersze + obrazy stron) - raz na zadanie.
    const attachments = await resolveAttachments(
      ctx,
      conversation.id,
      messages,
      contextStart(messages, conversation.contextSummary, conversation.contextFrom),
    );
    let lastInputTokens = 0;
    for (let calls = 0; ; calls++) {
      if (calls >= MAX_MODEL_CALLS) {
        send({ type: 'done', stop_reason: 'max_iterations' });
        return;
      }
      if (calls > 0 && Date.now() - started > TIME_BUDGET_MS) {
        send({ type: 'continue' });
        return;
      }

      send({ type: 'assistant_start' });
      const response = await streamModel(
        {
          apiKey: settings.apiKey,
          model: settings.model,
          system,
          tools,
          messages: modelMessages(messages, conversation.contextSummary, conversation.contextFrom, attachments),
          maxTokens: MAX_OUTPUT_TOKENS,
          signal: abort.signal,
        },
        send,
      );
      lastInputTokens = response.inputTokens;
      if (response.content.length === 0) {
        send({ type: 'done', stop_reason: response.stopReason });
        return;
      }
      const assistant: ApiMessage = { role: 'assistant', content: response.content };
      messages.push(assistant);
      send({ type: 'assistant_message', message: assistant });

      const uses = toolUsesOf(assistant);
      if (response.stopReason !== 'tool_use' || uses.length === 0) {
        send({ type: 'done', stop_reason: response.stopReason });
        if (response.stopReason === 'end_turn' && textOf(assistant)) {
          await intro;
          await afterTurn(conversation, attachments, turnKey, lastInputTokens, settings, abort.signal, send);
        }
        return;
      }
      const pending = uses.filter(needsApproval);
      if (pending.length > 0) {
        send({ type: 'approval_required', ids: pending.map((u) => u.id) });
        return;
      }
      const results = await executeToolUses(uses, {}, ctx, conversation.id, send);
      messages.push(results);
      send({ type: 'tool_results', message: results });
    }
  } catch (err) {
    if (!abort.signal.aborted) {
      if (err instanceof AnthropicApiError) {
        send({ type: 'error', error: err.message, code: err.code });
      } else {
        console.error('[poliai] stream error', err);
        send({ type: 'error', error: 'Wystąpił nieoczekiwany błąd PoliAI. Spróbuj ponownie.' });
      }
    }
  } finally {
    // Wstep zwykle konczy sie po ~1 s; czekamy na niego, zeby nie pisac do zamknietej odpowiedzi.
    await intro;
    await saveConversation(ctx, conversation).catch((err) => console.error('[poliai] save failed', err));
    finished = true;
    res.end();
  }
}

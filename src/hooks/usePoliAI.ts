import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  appendUserMessage,
  indexToolResults,
  isUserPromptMessage,
  lastTurnKey,
  readSseEvents,
  sanitizeActions,
  type ApiMessage,
  type AttachmentBlock,
  type DraftBlock,
  type PoliAIEvent,
  type PoliAIRequestBody,
  type TurnExtras,
} from '@/lib/poliai';
import { loadPoliAIConversation, POLIAI_CONVERSATIONS_KEY } from '@/hooks/usePoliAIConversations';

export type PoliAIStatus = 'idle' | 'loading' | 'streaming' | 'awaiting_approval' | 'error';

export interface PoliAIError {
  message: string;
  code?: string;
}

export interface PoliAIState {
  conversationId: string | null;
  title: string | null;
  messages: ApiMessage[];
  /** Od tego indeksu model widzi pełną historię; wcześniejsze tury są streszczone. */
  contextFrom: number;
  /** Strumieniowany szkic wiadomości asystenta (bloki po `index`, mogą mieć dziury). */
  draft: Array<DraftBlock | undefined>;
  runningToolIds: string[];
  pendingApprovalIds: string[];
  status: PoliAIStatus;
  error: PoliAIError | null;
  lastStopReason: string | null;
  /** Wstęp i przyciski per tura (klucz = indeks wiadomości użytkownika rozpoczynającej turę). */
  extras: Record<number, TurnExtras>;
  /** Tura, której dotyczy bieżące żądanie. */
  activeTurn: number;
  /** activeTurn była strumieniowana w tej sesji (płynne odsłanianie tekstu); false po wczytaniu historii. */
  streamed: boolean;
}

export interface PoliAIConversation extends PoliAIState {
  send: (text: string, attachments?: AttachmentBlock[]) => void;
  approve: (decisions: Record<string, boolean>) => void;
  retry: () => void;
  stop: () => void;
  reset: () => void;
  open: (conversationId: string) => void;
}

interface LoadedConversation {
  id: string;
  title: string | null;
  messages: ApiMessage[];
  contextFrom: number;
  extras: Record<number, TurnExtras>;
}

type Action =
  | { type: 'reset' }
  | { type: 'loading' }
  | { type: 'loaded'; conversation: LoadedConversation }
  | { type: 'request_start'; messages: ApiMessage[]; newTurn: boolean }
  | { type: 'event'; event: PoliAIEvent }
  | { type: 'aborted' }
  | { type: 'fail'; error: PoliAIError }
  /** Koniec strumienia - wstęp, którego nie dokończono, nie blokuje już odpowiedzi. */
  | { type: 'settle' };

const INITIAL_STATE: PoliAIState = {
  conversationId: null,
  title: null,
  messages: [],
  contextFrom: 0,
  draft: [],
  runningToolIds: [],
  pendingApprovalIds: [],
  status: 'idle',
  error: null,
  lastStopReason: null,
  extras: {},
  activeTurn: 0,
  streamed: false,
};

function updateExtras(state: PoliAIState, patch: (extras: TurnExtras) => Partial<TurnExtras>): PoliAIState {
  const current = state.extras[state.activeTurn] ?? { intro: '', introDone: true, actions: [] };
  return { ...state, extras: { ...state.extras, [state.activeTurn]: { ...current, ...patch(current) } } };
}

function applyEvent(state: PoliAIState, event: PoliAIEvent): PoliAIState {
  switch (event.type) {
    case 'conversation':
      return { ...state, conversationId: event.id, title: event.title ?? state.title };
    case 'title':
      return { ...state, title: event.title };
    case 'compacted':
      return { ...state, contextFrom: event.context_from };
    case 'assistant_start':
    case 'continue':
      return { ...state, draft: [] };
    case 'intro_delta':
      return updateExtras(state, (x) => ({ intro: x.intro + event.text }));
    case 'intro_done':
      return updateExtras(state, () => ({ introDone: true }));
    case 'suggestions':
      return updateExtras(state, () => ({ actions: sanitizeActions(event.actions) }));
    case 'block_start': {
      const draft = [...state.draft];
      draft[event.index] = { type: event.block.type, id: event.block.id, name: event.block.name, text: '' };
      return { ...state, draft };
    }
    case 'block_delta': {
      const block = state.draft[event.index];
      if (!block) return state;
      const draft = [...state.draft];
      draft[event.index] = { ...block, text: block.text + event.text };
      return { ...state, draft };
    }
    case 'assistant_message':
      return { ...state, messages: [...state.messages, event.message], draft: [] };
    case 'tool_running':
      return state.runningToolIds.includes(event.id)
        ? state
        : { ...state, runningToolIds: [...state.runningToolIds, event.id] };
    case 'tool_results': {
      const finished = indexToolResults([event.message]);
      return {
        ...state,
        messages: [...state.messages, event.message],
        runningToolIds: state.runningToolIds.filter((id) => !finished.has(id)),
      };
    }
    case 'approval_required':
      return { ...state, draft: [], runningToolIds: [], pendingApprovalIds: event.ids, status: 'awaiting_approval' };
    case 'done':
      return { ...state, draft: [], runningToolIds: [], status: 'idle', lastStopReason: event.stop_reason };
    case 'error':
      return {
        ...state,
        draft: [],
        runningToolIds: [],
        status: 'error',
        error: { message: event.error, code: event.code },
      };
    default:
      // Nieznany typ zdarzenia z nowszego serwera - ignorujemy.
      return state;
  }
}

function reducer(state: PoliAIState, action: Action): PoliAIState {
  switch (action.type) {
    case 'reset':
      return INITIAL_STATE;
    case 'loading':
      return { ...INITIAL_STATE, status: 'loading' };
    case 'loaded':
      return { ...INITIAL_STATE, ...action.conversation, conversationId: action.conversation.id };
    case 'request_start': {
      const activeTurn = lastTurnKey(action.messages);
      const previous = state.extras[activeTurn];
      const extras: TurnExtras = action.newTurn
        ? { intro: '', introDone: false, actions: [] }
        : { intro: previous?.intro ?? '', introDone: true, actions: [] };
      return {
        ...state,
        messages: action.messages,
        draft: [],
        runningToolIds: [],
        pendingApprovalIds: [],
        status: 'streaming',
        error: null,
        lastStopReason: null,
        activeTurn,
        streamed: true,
        extras: { ...state.extras, [activeTurn]: extras },
      };
    }
    case 'event':
      return applyEvent(state, action.event);
    case 'aborted':
      return updateExtras({ ...state, draft: [], runningToolIds: [], status: 'idle' }, () => ({ introDone: true }));
    case 'fail':
      return updateExtras(
        { ...state, draft: [], runningToolIds: [], status: 'error', error: action.error },
        () => ({ introDone: true }),
      );
    case 'settle':
      return updateExtras(state, () => ({ introDone: true }));
  }
}

const GENERIC_ERROR = 'PoliAI jest chwilowo niedostępny. Spróbuj ponownie za chwilę.';

export async function readHttpError(res: Response): Promise<PoliAIError> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      const code = 'code' in body && typeof body.code === 'string' ? body.code : undefined;
      return { message: body.error, code };
    }
  } catch {
    // Brak JSON-a (np. 404 z dev serwera) - komunikat zastępczy niżej.
  }
  if (res.status === 401) return { message: 'Sesja wygasła. Zaloguj się ponownie.' };
  return { message: GENERIC_ERROR };
}

type RequestPayload = Pick<PoliAIRequestBody, 'message' | 'attachment_ids' | 'approvals'>;

/**
 * Rozmowa z PoliAI. Historia jest zapisywana na serwerze (poliai_conversations) - klient wysyła
 * id rozmowy i nową wiadomość albo decyzje, a lokalnie składa widok ze zdarzeń SSE.
 * Każde żądanie ma własny identyfikator - zdarzenia po `stop()`/`reset()` albo z poprzedniego
 * żądania są ignorowane.
 */
export function usePoliAI(): PoliAIConversation {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const location = useLocation();
  const page = location.pathname + location.search;
  const queryClient = useQueryClient();

  const stateRef = useRef(state);
  const pageRef = useRef(page);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Ostatnie żądanie do ponowienia: nowa wiadomość, dopóki serwer jej nie zapisał (zdarzenie
  // `conversation`), potem kontynuacja bez treści.
  const retryPayloadRef = useRef<RequestPayload>({});

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (messages: ApiMessage[], payload: RequestPayload) => {
      abortRef.current?.abort();
      const requestId = ++requestIdRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      retryPayloadRef.current = payload;
      const last = messages[messages.length - 1];
      const asks = payload.message !== undefined || payload.attachment_ids !== undefined;
      dispatch({ type: 'request_start', messages, newTurn: asks && !!last && isUserPromptMessage(last) });

      let conversationId = stateRef.current.conversationId;
      let current: RequestPayload = payload;
      let refreshed = false;
      try {
        for (;;) {
          // Po uśpieniu karty token w pamięci bywa wygasły - po 401 odświeżamy sesję raz i ponawiamy.
          const { data } = refreshed ? await supabase.auth.refreshSession() : await supabase.auth.getSession();
          if (requestId !== requestIdRef.current) return;
          const token = data.session?.access_token;
          if (!token) {
            dispatch({ type: 'fail', error: { message: 'Sesja wygasła. Zaloguj się ponownie.' } });
            return;
          }

          const body: PoliAIRequestBody = { ...current, page: pageRef.current };
          if (conversationId) body.conversation_id = conversationId;
          const res = await fetch('/api/poliai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (requestId !== requestIdRef.current) return;
          if (res.status === 401 && !refreshed) {
            refreshed = true;
            continue;
          }
          if (!res.ok || !res.body) {
            dispatch({ type: 'fail', error: await readHttpError(res) });
            return;
          }
          refreshed = false;

          let outcome: 'continue' | 'finished' | null = null;
          for await (const event of readSseEvents(res.body)) {
            if (requestId !== requestIdRef.current) return;
            dispatch({ type: 'event', event });
            if (event.type === 'conversation') {
              conversationId = event.id;
              // Wiadomość jest już w bazie - ponowienie to kontynuacja.
              retryPayloadRef.current = {};
            } else if (event.type === 'continue') {
              outcome = 'continue';
              break;
            } else if (event.type === 'done' || event.type === 'approval_required' || event.type === 'error') {
              outcome = 'finished';
            }
          }
          if (requestId !== requestIdRef.current) return;
          dispatch({ type: 'settle' });
          void queryClient.invalidateQueries({ queryKey: POLIAI_CONVERSATIONS_KEY });
          if (outcome === 'continue') {
            // Serwer zapisał postęp - kolejne żądanie kontynuuje bez treści i bez decyzji.
            current = {};
            continue;
          }
          if (outcome === null) {
            dispatch({
              type: 'fail',
              error: { message: 'Połączenie z PoliAI zostało przerwane.', code: 'STREAM_INTERRUPTED' },
            });
          }
          return;
        }
      } catch {
        if (requestId !== requestIdRef.current) return;
        dispatch(
          controller.signal.aborted
            ? { type: 'aborted' }
            : { type: 'fail', error: { message: 'Brak połączenia z PoliAI. Sprawdź internet i spróbuj ponownie.' } },
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [queryClient],
  );

  const send = useCallback(
    (text: string, attachments: AttachmentBlock[] = []) => {
      const trimmed = text.trim();
      const { status, messages } = stateRef.current;
      if ((!trimmed && attachments.length === 0) || status === 'streaming' || status === 'loading') return;
      const message = trimmed || undefined;
      const attachmentIds = attachments.length > 0 ? attachments.map((a) => a.id) : undefined;
      void run(appendUserMessage(messages, message, attachments), { message, attachment_ids: attachmentIds });
    },
    [run],
  );

  const approve = useCallback(
    (decisions: Record<string, boolean>) => {
      if (stateRef.current.status !== 'awaiting_approval') return;
      void run(stateRef.current.messages, { approvals: decisions });
    },
    [run],
  );

  const retry = useCallback(() => {
    const { messages, status } = stateRef.current;
    if (messages.length === 0 || status === 'streaming') return;
    void run(messages, retryPayloadRef.current);
  }, [run]);

  const cancelRequest = () => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const stop = useCallback(() => {
    cancelRequest();
    dispatch({ type: 'aborted' });
  }, []);

  const reset = useCallback(() => {
    cancelRequest();
    retryPayloadRef.current = {};
    dispatch({ type: 'reset' });
  }, []);

  const open = useCallback((conversationId: string) => {
    cancelRequest();
    retryPayloadRef.current = {};
    const requestId = requestIdRef.current;
    dispatch({ type: 'loading' });
    loadPoliAIConversation(conversationId)
      .then((conversation) => {
        if (requestId === requestIdRef.current) dispatch({ type: 'loaded', conversation });
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        dispatch({ type: 'reset' });
        toast.error('Nie udało się otworzyć rozmowy. Mogła zostać usunięta.');
      });
  }, []);

  return useMemo(
    () => ({ ...state, send, approve, retry, stop, reset, open }),
    [state, send, approve, retry, stop, reset, open],
  );
}

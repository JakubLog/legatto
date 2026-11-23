// Most stdio JSON-RPC (Claude Desktop) ↔ Streamable HTTP (serwer MCP biura, POST <origin>/api/mcp).
//
// Każda wiadomość klienta to osobny POST z `Accept: application/json, text/event-stream`.
// Odpowiedź serwera: 202 (bez treści), application/json (obiekt albo tablica) albo text/event-stream
// (zdarzenia `message` z JSON-RPC). Identyfikator sesji (`Mcp-Session-Id`) z odpowiedzi na initialize
// jest dołączany do kolejnych żądań; 404 przy aktywnej sesji = sesja wygasła -> ponowna inicjalizacja.
// 401 -> odnowienie tokenu (refresh albo logowanie) i jednokrotne ponowienie.
// Klient zawsze dostaje odpowiedź na każde swoje żądanie (z błędem po polsku, gdy serwer jest nieosiągalny),
// poza żądaniami anulowanymi przez notifications/cancelled.

import { LegattoError, RPC_CODE, describeNetworkError } from './errors.mjs';
import { AbortedByClient, discardBody, httpRequest, parseJson, readText } from './http.mjs';
import { disabledMessage } from './oauth.mjs';
import { readSseEvents } from './sse.mjs';

/** @typedef {string | number} RequestId */

/** @param {unknown} value */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Żądanie (ma metodę i id) - wymaga odpowiedzi. @param {any} msg */
function isRequest(msg) {
  return isObject(msg) && typeof msg.method === 'string' && (typeof msg.id === 'string' || typeof msg.id === 'number');
}

/** @param {RequestId | null} id @param {LegattoError} err */
function errorResponse(id, err) {
  return { jsonrpc: '2.0', id, error: { code: err.code, message: err.message, data: { legatto: err.kind } } };
}

export class McpProxy {
  /**
   * @param {object} options
   * @param {string} options.mcpUrl
   * @param {string} options.host
   * @param {import('./auth.mjs').AccessTokenProvider | null} options.auth
   * @param {(message: unknown) => void} options.send   wiadomość do klienta (stdout)
   * @param {(message: string) => void} options.log      dziennik (stderr), bez tokenów
   * @param {string} options.userAgent
   * @param {LegattoError | null} [options.fatal]        błąd konfiguracji - każde żądanie dostaje ten błąd
   * @param {typeof fetch} [options.fetchImpl]
   * @param {number} [options.timeoutMs]                 limit czasu do nagłówków odpowiedzi
   */
  constructor({ mcpUrl, host, auth, send, log, userAgent, fatal = null, fetchImpl = fetch, timeoutMs }) {
    this.mcpUrl = mcpUrl;
    this.host = host;
    this.auth = auth;
    this.send = send;
    this.log = log;
    this.userAgent = userAgent;
    this.fatal = fatal;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    /** @type {string | null} */
    this.sessionId = null;
    /** @type {string | null} */
    this.protocolVersion = null;
    /** @type {any} ostatnie initialize klienta - do ponownej inicjalizacji po wygaśnięciu sesji */
    this.initializeMessage = null;
    /** @type {Promise<void> | null} */
    this.reinitializing = null;
    this.reinitCounter = 0;
    /** @type {Map<RequestId, AbortController>} */
    this.inflight = new Map();
    /** @type {Set<RequestId>} */
    this.cancelled = new Set();
    this.closed = false;
    /** @type {string | null} ostatni użyty token (tylko w pamięci, do DELETE sesji przy zamknięciu) */
    this.lastToken = null;
  }

  /**
   * Obsługa wiadomości od klienta (obiekt albo tablica JSON-RPC). Nigdy nie odrzuca.
   * @param {unknown} message
   */
  async handle(message) {
    if (this.closed) return;
    const messages = Array.isArray(message) ? message : [message];
    if (messages.length === 0 || !messages.every(isObject)) {
      this.send({ jsonrpc: '2.0', id: null, error: { code: RPC_CODE.INVALID_REQUEST, message: 'Niepoprawna wiadomość JSON-RPC' } });
      return;
    }
    /** @type {RequestId[]} */
    const ids = messages.filter(isRequest).map((m) => m.id);

    if (this.fatal) {
      for (const id of ids) this.send(errorResponse(id, this.fatal));
      return;
    }

    for (const msg of messages) {
      if (msg.method === 'notifications/cancelled' && isObject(msg.params)) {
        this.cancel(msg.params.requestId);
      }
    }
    const initialize = messages.find((m) => isRequest(m) && m.method === 'initialize');
    if (initialize) {
      // Nowa sesja klienta: poprzednia sesja HTTP przestaje obowiązywać.
      this.initializeMessage = initialize;
      this.sessionId = null;
      this.protocolVersion = null;
    }

    const controller = new AbortController();
    for (const id of ids) this.inflight.set(id, controller);
    /** @type {Set<RequestId>} */
    const pending = new Set(ids);
    try {
      if (!initialize && this.reinitializing) await this.reinitializing;
      const payload = Array.isArray(message) ? messages : messages[0];
      let response = await this.post(payload, controller.signal);
      if (response.status === 404 && this.sessionId && !initialize) {
        await discardBody(response);
        this.log('Sesja serwera MCP wygasła – inicjalizuję ponownie.');
        await this.reinitialize(this.sessionId);
        response = await this.post(payload, controller.signal);
      }
      await this.consume(response, pending, Boolean(initialize), (msg) => this.send(msg), controller.signal);
    } catch (err) {
      if (err instanceof AbortedByClient || controller.signal.aborted) {
        for (const id of pending) {
          if (!this.cancelled.has(id)) this.send(errorResponse(id, new LegattoError('Żądanie przerwane.', { kind: 'server' })));
        }
        pending.clear();
      } else {
        const error = err instanceof LegattoError ? err : describeNetworkError(err, this.host);
        this.log(error.message);
        for (const id of pending) this.send(errorResponse(id, error));
        pending.clear();
      }
    } finally {
      for (const id of pending) {
        if (!this.cancelled.has(id)) {
          this.send(errorResponse(id, new LegattoError('Serwer biura nie zwrócił odpowiedzi na żądanie.', { kind: 'protocol' })));
        }
      }
      for (const id of ids) {
        if (this.inflight.get(id) === controller) this.inflight.delete(id);
        this.cancelled.delete(id);
      }
    }
  }

  /** @param {unknown} requestId */
  cancel(requestId) {
    if (typeof requestId !== 'string' && typeof requestId !== 'number') return;
    const controller = this.inflight.get(requestId);
    if (!controller) return;
    this.cancelled.add(requestId);
    controller.abort();
  }

  /**
   * POST z tokenem; 401 -> odnowienie tokenu i jedno ponowienie.
   * @param {unknown} payload
   * @param {AbortSignal} [signal]
   */
  async post(payload, signal) {
    const auth = /** @type {import('./auth.mjs').AccessTokenProvider} */ (this.auth);
    const body = JSON.stringify(payload);
    let token = await auth.getAccessToken();
    this.lastToken = token;
    let response = await this.fetchOnce(body, token, signal);
    if (response.status !== 401) return response;
    await discardBody(response);
    token = await auth.onUnauthorized(token);
    this.lastToken = token;
    response = await this.fetchOnce(body, token, signal);
    if (response.status === 401) {
      await discardBody(response);
      throw new LegattoError(
        'Serwer biura odrzucił autoryzację. Sprawdź, czy Twoje konto ma dostęp do integracji z Claude, i zaloguj się ponownie.',
        { kind: 'auth' },
      );
    }
    return response;
  }

  /** @param {string} body @param {string} token @param {AbortSignal} [signal] */
  fetchOnce(body, token, signal) {
    /** @type {Record<string, string>} */
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'User-Agent': this.userAgent,
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    if (this.protocolVersion) headers['MCP-Protocol-Version'] = this.protocolVersion;
    return httpRequest(
      this.mcpUrl,
      { method: 'POST', headers, body },
      { host: this.host, fetchImpl: this.fetchImpl, signal, timeoutMs: this.timeoutMs },
    );
  }

  /**
   * Przetwarza odpowiedź serwera i przekazuje wiadomości do `deliver`.
   * @param {Response} response
   * @param {Set<RequestId>} pending   id żądań czekających na odpowiedź (usuwane po dostarczeniu)
   * @param {boolean} isInitialize
   * @param {(message: any) => void} deliver
   * @param {AbortSignal} [signal]
   */
  async consume(response, pending, isInitialize, deliver, signal) {
    if (response.status === 202) {
      await discardBody(response);
      return;
    }
    if (!response.ok) {
      throw await this.httpError(response);
    }
    if (isInitialize) this.sessionId = response.headers.get('mcp-session-id') || null;

    const route = (/** @type {any} */ msg) => {
      if (!isObject(msg)) return;
      if (typeof msg.method === 'string') {
        // Żądanie albo powiadomienie serwera - do klienta bez zmian.
        deliver(msg);
        return;
      }
      let id = msg.id;
      if (id === null && isObject(msg.error) && pending.size === 1) {
        // Błąd bez id (np. parse error) dotyczy jedynego żądania z tego POST-a.
        id = pending.values().next().value;
      }
      if (!pending.has(id)) return; // odpowiedź na powiadomienie (serwer biura odpowiada {id:null}) - pomijamy
      pending.delete(id);
      if (isInitialize && isObject(msg.result) && typeof msg.result.protocolVersion === 'string') {
        this.protocolVersion = msg.result.protocolVersion;
      }
      deliver(id === msg.id ? msg : { ...msg, id });
    };

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    try {
      if (contentType.startsWith('text/event-stream')) {
        if (!response.body) return;
        for await (const event of readSseEvents(response.body)) {
          if (event.event !== 'message' || event.data === '') continue;
          const parsed = parseJson(event.data);
          if (parsed === null) {
            this.log('Pominięto niepoprawne zdarzenie SSE z serwera biura.');
            continue;
          }
          for (const msg of Array.isArray(parsed) ? parsed : [parsed]) route(msg);
        }
        return;
      }
      const text = await readText(response);
      if (text.trim() === '') return;
      if (!contentType.includes('json')) {
        throw new LegattoError(
          `Nieoczekiwana odpowiedź serwera biura (${contentType || 'brak Content-Type'}). Sprawdź adres biura.`,
          { kind: 'protocol' },
        );
      }
      const parsed = parseJson(text);
      if (parsed === null) {
        throw new LegattoError('Serwer biura zwrócił niepoprawny JSON.', { kind: 'protocol' });
      }
      for (const msg of Array.isArray(parsed) ? parsed : [parsed]) route(msg);
    } catch (err) {
      if (signal?.aborted) throw new AbortedByClient();
      if (err instanceof LegattoError) throw err;
      // Zerwane połączenie w trakcie czytania odpowiedzi.
      throw describeNetworkError(err, this.host);
    }
  }

  /** @param {Response} response */
  async httpError(response) {
    const status = response.status;
    let body = null;
    try {
      body = parseJson(await readText(response, 64 * 1024));
    } catch {
      body = null;
    }
    if (status === 404 && isObject(body) && (body.code === 'MCP_DISABLED' || body.code === 'AI_DISABLED')) {
      return new LegattoError(disabledMessage(body), { kind: 'server' });
    }
    const serverMessage = isObject(body)
      ? typeof body.error === 'string'
        ? body.error
        : isObject(body.error) && typeof body.error.message === 'string'
          ? body.error.message
          : ''
      : '';
    const suffix = serverMessage ? `: ${serverMessage.slice(0, 300)}` : '';
    if (status === 404) {
      return new LegattoError(
        `Nie znaleziono serwera MCP pod adresem ${this.mcpUrl} (HTTP 404). Sprawdź adres biura w ustawieniach rozszerzenia.`,
        { kind: 'config' },
      );
    }
    if (status >= 500) {
      return new LegattoError(`Serwer biura zwrócił błąd (HTTP ${status})${suffix}. Spróbuj ponownie za chwilę.`, {
        kind: 'server',
      });
    }
    return new LegattoError(`Serwer biura odrzucił żądanie (HTTP ${status})${suffix}.`, {
      kind: status === 403 ? 'auth' : 'server',
    });
  }

  /**
   * Ponowna inicjalizacja po wygaśnięciu sesji: initialize z zapamiętanymi parametrami klienta
   * + notifications/initialized. Odpowiedzi nie trafiają do klienta.
   * @param {string} expiredSessionId
   */
  reinitialize(expiredSessionId) {
    if (this.reinitializing) return this.reinitializing;
    if (this.sessionId !== expiredSessionId) return Promise.resolve(); // inne żądanie już odnowiło sesję
    if (!this.initializeMessage) {
      return Promise.reject(new LegattoError('Sesja serwera MCP wygasła. Uruchom ponownie rozszerzenie Legatto.', { kind: 'protocol' }));
    }
    this.reinitializing = (async () => {
      this.sessionId = null;
      this.protocolVersion = null;
      this.reinitCounter += 1;
      const id = `legatto-reinit-${this.reinitCounter}`;
      const pending = new Set([id]);
      const response = await this.post({ ...this.initializeMessage, id });
      await this.consume(response, pending, true, () => {});
      if (pending.size > 0) {
        throw new LegattoError('Nie udało się wznowić sesji serwera MCP.', { kind: 'protocol' });
      }
      const ack = await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
      await this.consume(ack, new Set(), false, () => {});
    })().finally(() => {
      this.reinitializing = null;
    });
    return this.reinitializing;
  }

  /** Zamknięcie: przerwanie żądań, zakończenie sesji HTTP (DELETE), zamknięcie logowania. */
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const controller of this.inflight.values()) controller.abort();
    this.inflight.clear();
    // Bez nowego logowania przy zamykaniu: DELETE tylko z tokenem, którego sesja już używała.
    const token = this.lastToken;
    if (this.sessionId && token) {
      try {
        const response = await httpRequest(
          this.mcpUrl,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}`, 'Mcp-Session-Id': this.sessionId, 'User-Agent': this.userAgent },
          },
          { host: this.host, fetchImpl: this.fetchImpl, timeoutMs: 3000 },
        );
        await discardBody(response);
      } catch {
        // Najlepsza próba - serwer i tak wygasi sesję.
      }
      this.sessionId = null;
    }
    this.auth?.close();
  }
}

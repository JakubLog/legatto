// Wspólne wywołanie HTTP (fetch z Node ≥ 20) do serwera biura: limit czasu do nagłówków odpowiedzi,
// bez automatycznych przekierowań (nagłówek Authorization ani sekret klienta nie mogą trafić pod inny adres),
// błędy sieci zamieniane na polskie komunikaty.

import { LegattoError, describeNetworkError } from './errors.mjs';

export const DEFAULT_HEADERS_TIMEOUT_MS = 120_000;
export const MAX_JSON_BYTES = 16 * 1024 * 1024;

/** Błąd przerwania żądania przez klienta (notifications/cancelled albo zamknięcie rozszerzenia). */
export class AbortedByClient extends Error {
  constructor() {
    super('Żądanie anulowane');
    this.name = 'AbortedByClient';
  }
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {{ host: string, fetchImpl?: typeof fetch, signal?: AbortSignal, timeoutMs?: number }} options
 * @returns {Promise<Response>}
 */
export async function httpRequest(url, init, { host, fetchImpl = fetch, signal, timeoutMs = DEFAULT_HEADERS_TIMEOUT_MS }) {
  if (signal?.aborted) throw new AbortedByClient();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let response;
  try {
    response = await fetchImpl(url, { ...init, redirect: 'manual', signal: controller.signal });
  } catch (err) {
    if (signal?.aborted) throw new AbortedByClient();
    if (timedOut) {
      throw new LegattoError(
        `Serwer biura (${host}) nie odpowiedział w wymaganym czasie. Sprawdź połączenie VPN biura i spróbuj ponownie.`,
        { kind: 'timeout', cause: err },
      );
    }
    throw describeNetworkError(err, host);
  } finally {
    clearTimeout(timer);
  }
  // Ciało czytane po nagłówkach nadal reaguje na anulowanie przez klienta (onAbort -> controller.abort()).
  if (response.status >= 300 && response.status < 400) {
    await discardBody(response);
    const location = response.headers.get('location') ?? '';
    throw new LegattoError(
      `Serwer biura przekierował żądanie (HTTP ${response.status}${location ? ` → ${location}` : ''}). ` +
        'Sprawdź adres biura w ustawieniach rozszerzenia.',
      { kind: 'config' },
    );
  }
  return response;
}

/** Odrzuca ciało odpowiedzi (zwalnia połączenie). @param {Response} response */
export async function discardBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // strumień już zamknięty
  }
}

/**
 * Ciało odpowiedzi jako tekst z limitem rozmiaru.
 * @param {Response} response
 */
export async function readText(response, limit = MAX_JSON_BYTES) {
  if (!response.body) return '';
  const decoder = new TextDecoder('utf-8');
  let size = 0;
  let text = '';
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) {
      await discardBody(response);
      throw new LegattoError('Odpowiedź serwera biura jest zbyt duża.', { kind: 'protocol' });
    }
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

/** JSON albo null, gdy treść nie jest poprawnym JSON-em. @param {string} text */
export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

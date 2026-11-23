// Parser strumienia text/event-stream (WHATWG HTML, "Parsing an event stream")
// dla odpowiedzi Streamable HTTP serwera MCP.

/** Górna granica pojedynczej linii i danych jednego zdarzenia (ochrona pamięci). */
export const MAX_EVENT_CHARS = 16 * 1024 * 1024;

/**
 * Przyrostowy parser: przyjmuje kolejne fragmenty tekstu (podział w dowolnym miejscu,
 * także między CR a LF) i wywołuje onEvent dla każdego kompletnego zdarzenia.
 * Zdarzenie niezakończone pustą linią przed końcem strumienia jest odrzucane (zgodnie ze specyfikacją).
 */
export class SseParser {
  /** @param {(event: { event: string, data: string, id: string }) => void} onEvent */
  constructor(onEvent, maxChars = MAX_EVENT_CHARS) {
    this.onEvent = onEvent;
    this.maxChars = maxChars;
    this.buffer = '';
    this.skipLeadingLf = false;
    this.data = '';
    this.hasData = false;
    this.eventType = '';
    this.lastEventId = '';
  }

  /** @param {string} text */
  push(text) {
    let buffer = this.buffer + text;
    let start = 0;
    if (this.skipLeadingLf && buffer.length > 0) {
      if (buffer.charCodeAt(0) === 10) start = 1;
      this.skipLeadingLf = false;
    }
    for (let i = start; i < buffer.length; i += 1) {
      const c = buffer.charCodeAt(i);
      if (c !== 10 && c !== 13) continue;
      this.line(buffer.slice(start, i));
      if (c === 13) {
        if (i + 1 < buffer.length) {
          if (buffer.charCodeAt(i + 1) === 10) i += 1;
        } else {
          this.skipLeadingLf = true;
        }
      }
      start = i + 1;
    }
    buffer = buffer.slice(start);
    if (buffer.length > this.maxChars) throw new Error('Zbyt długa linia w strumieniu SSE');
    this.buffer = buffer;
  }

  /** Koniec strumienia: niedokończona linia i zdarzenie są odrzucane. */
  end() {
    this.buffer = '';
    this.data = '';
    this.hasData = false;
    this.eventType = '';
  }

  /** @param {string} line */
  line(line) {
    if (line === '') {
      this.dispatch();
      return;
    }
    if (line.charCodeAt(0) === 58) return; // ':' - komentarz (np. keep-alive)
    const colon = line.indexOf(':');
    let field = line;
    let value = '';
    if (colon >= 0) {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.charCodeAt(0) === 32) value = value.slice(1);
    }
    switch (field) {
      case 'data':
        this.data = this.hasData ? `${this.data}\n${value}` : value;
        this.hasData = true;
        if (this.data.length > this.maxChars) throw new Error('Zbyt duże zdarzenie w strumieniu SSE');
        break;
      case 'event':
        this.eventType = value;
        break;
      case 'id':
        if (!value.includes('\u0000')) this.lastEventId = value;
        break;
      default:
        // retry i nieznane pola są ignorowane
        break;
    }
  }

  dispatch() {
    const hasData = this.hasData;
    const event = { event: this.eventType || 'message', data: this.data, id: this.lastEventId };
    this.data = '';
    this.hasData = false;
    this.eventType = '';
    if (hasData) this.onEvent(event);
  }
}

/**
 * Zdarzenia z ciała odpowiedzi fetch (ReadableStream<Uint8Array> lub inny async iterable bajtów).
 * @param {AsyncIterable<Uint8Array>} body
 */
export async function* readSseEvents(body) {
  const decoder = new TextDecoder('utf-8');
  /** @type {{ event: string, data: string, id: string }[]} */
  const queue = [];
  const parser = new SseParser((event) => queue.push(event));
  for await (const chunk of body) {
    parser.push(decoder.decode(chunk, { stream: true }));
    while (queue.length > 0) yield /** @type {{ event: string, data: string, id: string }} */ (queue.shift());
  }
  parser.push(decoder.decode());
  parser.end();
  while (queue.length > 0) yield /** @type {{ event: string, data: string, id: string }} */ (queue.shift());
}

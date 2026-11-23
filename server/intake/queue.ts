// Klient HTTP pull consumer Cloudflare Queues (pull + ack/retry).
// https://developers.cloudflare.com/queues/configuration/pull-consumers/
// Token (Queues Edit, filtr IP serwera) tylko w nagłówku Authorization; nigdy w logach.

import type { HttpClient } from './http';

export interface PulledMessage {
  id: string;
  lease_id: string;
  attempts: number;
  timestamp_ms: number;
  /** Treść wiadomości; dla contentType "bytes" - base64. */
  body: string;
}

export interface PullResult {
  messages: PulledMessage[];
  backlog: number | null;
}

export interface AckResult {
  ok: boolean;
  /** CF odrzucił dzierżawę (wygasła/nieznana) - wpis i tak można usunąć. */
  leaseInvalid: boolean;
  status: number;
}

interface CfEnvelope<T> {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: T;
}

export class QueueApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'QueueApiError';
  }
}

export class QueueClient {
  constructor(
    private readonly http: HttpClient,
    private readonly apiBase: string,
    private readonly accountId: string,
    private readonly token: string,
  ) {
    if (!/^[0-9a-f]{32}$/.test(accountId)) throw new Error('LEGATTO_CF_ACCOUNT_ID: oczekiwano 32 znaków hex');
  }

  private url(queueId: string, action: 'pull' | 'ack'): string {
    if (!/^[0-9a-f]{32}$/.test(queueId)) throw new Error('identyfikator kolejki: oczekiwano 32 znaków hex');
    return `${this.apiBase.replace(/\/+$/, '')}/accounts/${this.accountId}/queues/${queueId}/messages/${action}`;
  }

  private async post<T>(url: string, body: unknown): Promise<{ status: number; data: CfEnvelope<T> }> {
    const res = await this.http.request(
      'POST',
      url,
      { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      JSON.stringify(body),
    );
    let data: CfEnvelope<T> = {};
    try {
      data = JSON.parse(res.body.toString('utf8')) as CfEnvelope<T>;
    } catch {
      data = {};
    }
    return { status: res.status, data };
  }

  async pull(queueId: string, batchSize: number, visibilityTimeoutMs: number): Promise<PullResult> {
    const { status, data } = await this.post<{ messages?: unknown[]; message_backlog_count?: unknown }>(
      this.url(queueId, 'pull'),
      { batch_size: batchSize, visibility_timeout_ms: visibilityTimeoutMs },
    );
    if (status !== 200 || data.success !== true || !data.result) {
      throw new QueueApiError(status, `pull: HTTP ${status} ${describeErrors(data)}`);
    }
    const messages: PulledMessage[] = [];
    for (const raw of data.result.messages ?? []) {
      const m = raw as Record<string, unknown>;
      if (
        typeof m.id !== 'string' ||
        typeof m.lease_id !== 'string' ||
        typeof m.body !== 'string' ||
        typeof m.attempts !== 'number' ||
        typeof m.timestamp_ms !== 'number'
      ) {
        throw new QueueApiError(status, 'pull: niepoprawny format wiadomości');
      }
      messages.push({ id: m.id, lease_id: m.lease_id, body: m.body, attempts: m.attempts, timestamp_ms: m.timestamp_ms });
    }
    const backlog = data.result.message_backlog_count;
    return { messages, backlog: typeof backlog === 'number' ? backlog : null };
  }

  async ack(queueId: string, acks: string[], retries: { lease_id: string; delay_seconds: number }[]): Promise<AckResult> {
    const { status, data } = await this.post<unknown>(this.url(queueId, 'ack'), {
      acks: acks.map((lease_id) => ({ lease_id })),
      retries,
    });
    if (status === 200 && data.success === true) return { ok: true, leaseInvalid: false, status };
    const leaseInvalid = status >= 400 && status < 500 && /lease/i.test(describeErrors(data));
    return { ok: false, leaseInvalid, status };
  }
}

function describeErrors(data: CfEnvelope<unknown>): string {
  return (data.errors ?? [])
    .map((e) => `${e.code ?? ''} ${e.message ?? ''}`.trim())
    .join('; ')
    .slice(0, 300);
}

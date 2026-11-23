// Klient Resend (REST, bez SDK). RESEND_API_URL nadpisuje adres (testy z atrapą).
// Każde zapytanie do Resend idzie przez `call` - tam bramka INSTANCE_EMAIL (operator instancji) dla
// powiadomień. Maile Auth (hook GoTrue → server/auth-email-hook.ts) jej nie podlegają: bez nich nie
// da się zaprosić użytkownika ani zresetować hasła.

import { z } from 'zod';
import { instanceFlags } from '../instance.js';

const DEFAULT_API = 'https://api.resend.com';
const TIMEOUT_MS = 10_000;

function apiBase(): string {
  return (process.env.RESEND_API_URL?.trim() || DEFAULT_API).replace(/\/+$/, '');
}

export class ResendError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number | null;
  constructor(status: number, code: string, message: string, retryAfter: number | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }

  /** Błąd przejściowy albo konfiguracji (klucz, domena) - warto ponowić później. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 401 || this.status === 403 || this.status === 429;
  }
}

const ErrorBody = z.object({ name: z.string().optional(), message: z.string().optional() }).loose();
const SendResponse = z.object({ id: z.string() }).loose();
const DomainsResponse = z
  .object({
    data: z.array(z.object({ name: z.string().catch(''), status: z.string().catch('') }).loose()).catch([]),
  })
  .loose();

/** `notifications` - powiadomienia (bramka INSTANCE_EMAIL); `auth` - maile Auth z hooka GoTrue. */
export type EmailPurpose = 'notifications' | 'auth';

async function call(
  key: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
  purpose: EmailPurpose = 'notifications',
): Promise<unknown> {
  if (purpose === 'notifications' && !instanceFlags().email) {
    throw new ResendError(409, 'email_disabled', 'Wysyłka e-mail jest wyłączona przez operatora instancji.');
  }
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Odczyt treści też pod limitem czasu - urwana odpowiedź to błąd sieci do ponowienia.
    text = await res.text();
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'przekroczono czas odpowiedzi' : 'brak połączenia';
    throw new ResendError(0, 'network', `Resend: ${reason}`);
  }
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const parsed = ErrorBody.safeParse(json);
    const err = parsed.success ? parsed.data : {};
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new ResendError(
      res.status,
      err.name || `http_${res.status}`,
      err.message || `Resend: HTTP ${res.status}`,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
  return json;
}

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

/** Wysyła jedną wiadomość; zwraca id Resend. Idempotency-Key chroni przed duplikatem przy ponowieniu. */
export async function sendEmail(
  key: string,
  message: EmailMessage,
  idempotencyKey: string,
  purpose: EmailPurpose = 'notifications',
): Promise<string> {
  const json = await call(
    key,
    'POST',
    '/emails',
    {
      from: message.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      ...(message.tags?.length ? { tags: message.tags } : {}),
    },
    idempotencyKey,
    purpose,
  );
  const parsed = SendResponse.safeParse(json);
  return parsed.success ? parsed.data.id : '';
}

export interface KeyCheck {
  ok: boolean;
  code?: string;
  message?: string;
  domains?: { name: string; status: string }[];
}

/**
 * Weryfikacja klucza listą domen. Klucz tylko do wysyłki („Sending access”) dostaje
 * `restricted_api_key` - jest poprawny, tylko bez wglądu w domeny.
 */
export async function checkKey(key: string): Promise<KeyCheck> {
  try {
    const parsed = DomainsResponse.safeParse(await call(key, 'GET', '/domains'));
    const domains = parsed.success ? parsed.data.data : [];
    return { ok: true, domains: domains.map((d) => ({ name: d.name, status: d.status })) };
  } catch (err) {
    if (err instanceof ResendError) {
      if (err.code === 'restricted_api_key') return { ok: true, code: err.code };
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }
}

// Send Email Hook GoTrue (VPS): Auth nie ma SMTP; każdy mail Auth (zaproszenie, reset hasła, link
// logowania, zmiana adresu, kod reautoryzacji) przychodzi tu podpisany (Standard Webhooks,
// GOTRUE_HOOK_SEND_EMAIL_SECRETS) i wychodzi przez Resend API (egress app → api.resend.com) kluczem
// i nadawcą z Integracje → Powiadomienia. Listener wewnętrzny :3001 (sieć legatto-int), Caddy go nie
// proxuje.
//
// Format: https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
// Odpowiedź: 200 {} albo kod błędu z {"error":{"http_code","message"}} (GoTrue pokazuje komunikat).

import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingHttpHeaders } from 'node:http';
import { configuredInstanceOrigin } from '../api/_lib/issuer.js';
import { sendEmail } from '../api/_lib/notifications/resend.js';
import { loadResendKey, loadSettings } from '../api/_lib/notifications/settings.js';
import { escapeHtml } from './runtime-config.js';

/** Dopuszczalna różnica czasu podpisu (Standard Webhooks: 5 min). */
const TOLERANCE_SECONDS = 5 * 60;

export class HookError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** `v1,whsec_<base64>` (kilka sekretów rozdzielonych `|`, jak w GoTrue) → klucze HMAC. */
export function parseHookSecrets(raw: string | undefined): Buffer[] {
  const keys: Buffer[] = [];
  for (const part of (raw ?? '').split('|')) {
    const value = part.trim();
    if (!value) continue;
    const m = /^v1,whsec_([A-Za-z0-9+/=]+)$/.exec(value);
    if (!m) throw new Error('GOTRUE_HOOK_SEND_EMAIL_SECRETS: oczekiwano "v1,whsec_<base64>"');
    keys.push(Buffer.from(m[1], 'base64'));
  }
  return keys;
}

function header(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** Weryfikacja podpisu Standard Webhooks; błąd = HookError 401. */
export function verifyWebhook(keys: Buffer[], headers: IncomingHttpHeaders, body: Buffer, nowSeconds: number): void {
  const id = header(headers, 'webhook-id');
  const timestamp = header(headers, 'webhook-timestamp');
  const signatures = header(headers, 'webhook-signature');
  if (!id || !/^\d{1,12}$/.test(timestamp) || !signatures) throw new HookError(401, 'Brak nagłówków podpisu');
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) throw new HookError(401, 'Podpis przeterminowany');
  const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), body]);
  for (const key of keys) {
    const expected = createHmac('sha256', key).update(signed).digest();
    for (const candidate of signatures.split(' ')) {
      const [version, value] = candidate.split(',', 2);
      if (version !== 'v1' || !value) continue;
      const given = Buffer.from(value, 'base64');
      if (given.length === expected.length && timingSafeEqual(given, expected)) return;
    }
  }
  throw new HookError(401, 'Niepoprawny podpis');
}

interface HookPayload {
  user: { email?: string; new_email?: string; user_metadata?: Record<string, unknown> };
  email_data: {
    token?: string;
    token_hash?: string;
    token_new?: string;
    token_hash_new?: string;
    redirect_to?: string;
    email_action_type?: string;
    site_url?: string;
  };
}

export interface AuthEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Rodzaj do tagu Resend (bez danych osobowych). */
  kind: string;
}

type LinkKind = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change';

const COPY: Record<LinkKind, { subject: string; heading: string; intro: string; action: string }> = {
  signup: {
    subject: 'Potwierdź adres e-mail',
    heading: 'Potwierdzenie adresu e-mail',
    intro: 'Potwierdź adres e-mail konta w systemie biura poselskiego.',
    action: 'Potwierdź adres',
  },
  invite: {
    subject: 'Zaproszenie do systemu biura poselskiego',
    heading: 'Zaproszenie do systemu biura',
    intro: 'Twoje konto w systemie biura poselskiego jest gotowe - ustaw hasło, by się zalogować.',
    action: 'Ustaw hasło',
  },
  magiclink: {
    subject: 'Link logowania do systemu biura',
    heading: 'Link logowania',
    intro: 'Użyj przycisku, aby zalogować się do systemu biura poselskiego. Link jest jednorazowy.',
    action: 'Zaloguj się',
  },
  recovery: {
    subject: 'Ustawienie nowego hasła',
    heading: 'Ustawienie nowego hasła',
    intro: 'Otrzymaliśmy prośbę o ustawienie nowego hasła do Twojego konta. Jeśli to nie Ty, zignoruj tę wiadomość.',
    action: 'Ustaw nowe hasło',
  },
  email_change: {
    subject: 'Potwierdź zmianę adresu e-mail',
    heading: 'Zmiana adresu e-mail',
    intro: 'Potwierdź zmianę adresu e-mail konta w systemie biura poselskiego. Jeśli to nie Ty, zignoruj tę wiadomość i powiadom Posła.',
    action: 'Potwierdź zmianę',
  },
};

function layout(heading: string, paragraphs: string[], button?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px; font-size:15px; line-height:1.6; color:#334155;">${p}</p>`).join('');
  const cta = button
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(button.url)}" style="display:inline-block; background-color:#2563eb; color:#ffffff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:600;">${escapeHtml(button.label)}</a></p>` +
      `<p style="margin:0; font-size:13px; line-height:1.5; color:#64748b;">Jeśli przycisk nie działa, skopiuj adres: <a href="${escapeHtml(button.url)}" style="color:#2563eb;">${escapeHtml(button.url)}</a></p>`
    : '';
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(heading)}</title></head>` +
    `<body style="margin:0; padding:32px 16px; background-color:#f1f5f9; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">` +
    `<div style="max-width:600px; margin:0 auto; background-color:#ffffff; border-radius:12px; padding:32px 40px;">` +
    `<p style="margin:0 0 6px; font-size:13px; color:#94a3b8; letter-spacing:0.08em; text-transform:uppercase;">Biuro Poselskie</p>` +
    `<h1 style="margin:0 0 24px; font-size:22px; color:#0f172a;">${escapeHtml(heading)}</h1>${body}${cta}</div></body></html>`;
}

/** Link weryfikacji GoTrue pod originem instancji (gateway Supabase jest pod tym samym originem). */
export function verifyUrl(origin: string, tokenHash: string, type: string, redirectTo: string | undefined): string {
  const params = new URLSearchParams({ token: tokenHash, type });
  if (redirectTo) params.set('redirect_to', redirectTo);
  return `${origin}/auth/v1/verify?${params.toString()}`;
}

/** Szablon zaproszenia z repo (ten sam co w Supabase Cloud, supabase/config.toml) z wartościami hooka. */
export function renderInviteTemplate(template: string, confirmationUrl: string, siteUrl: string, fullName: string): string {
  return template
    .replace(/\{\{ if \.Data\.full_name \}\}([\s\S]*?)\{\{ end \}\}/g, (_m, inner: string) => (fullName ? inner : ''))
    .replaceAll('{{ .Data.full_name }}', escapeHtml(fullName))
    .replaceAll('{{ .ConfirmationURL }}', escapeHtml(confirmationUrl))
    .replaceAll('{{ .SiteURL }}', escapeHtml(siteUrl));
}

/** Maile do wysłania dla zdarzenia hooka (email_change z bezpieczną zmianą = dwa maile). */
export function buildAuthEmails(payload: HookPayload, origin: string, inviteTemplate: string): AuthEmail[] {
  const data = payload.email_data ?? {};
  const type = data.email_action_type ?? '';
  const email = payload.user?.email ?? '';
  const redirectTo = data.redirect_to || undefined;
  const fullNameRaw = payload.user?.user_metadata?.full_name;
  const fullName = typeof fullNameRaw === 'string' ? fullNameRaw.trim().slice(0, 200) : '';

  if (type === 'reauthentication') {
    if (!email || !data.token) throw new HookError(400, 'Brak adresu lub kodu');
    const heading = 'Kod potwierdzenia';
    const paragraphs = [
      'Kod potwierdzenia operacji w systemie biura poselskiego:',
      `<strong style="font-size:24px; letter-spacing:0.2em;">${escapeHtml(data.token)}</strong>`,
      'Kod jest ważny kilka minut. Jeśli to nie Ty, zignoruj tę wiadomość.',
    ];
    return [
      {
        to: email,
        subject: heading,
        html: layout(heading, paragraphs),
        text: `${heading}: ${data.token}\n\nJeśli to nie Ty, zignoruj tę wiadomość.\n`,
        kind: type,
      },
    ];
  }

  if (!(type in COPY)) throw new HookError(422, 'Nieobsługiwany rodzaj wiadomości Auth');
  const kind = type as LinkKind;
  const copy = COPY[kind];
  const message = (to: string, tokenHash: string): AuthEmail => {
    const url = verifyUrl(origin, tokenHash, kind, redirectTo);
    const html =
      kind === 'invite'
        ? renderInviteTemplate(inviteTemplate, url, origin, fullName)
        : layout(copy.heading, [escapeHtml(copy.intro)], { label: copy.action, url });
    return { to, subject: copy.subject, html, text: `${copy.intro}\n\n${copy.action}: ${url}\n`, kind };
  };

  if (kind === 'email_change') {
    const newEmail = payload.user?.new_email ?? '';
    if (!newEmail) throw new HookError(400, 'Brak nowego adresu');
    // Nazwy pól odwrócone w GoTrue: token_hash_new → obecny adres, token_hash → nowy adres.
    if (data.token_hash_new) {
      if (!email || !data.token_hash) throw new HookError(400, 'Brak tokenu zmiany adresu');
      return [message(email, data.token_hash_new), message(newEmail, data.token_hash)];
    }
    if (!data.token_hash) throw new HookError(400, 'Brak tokenu zmiany adresu');
    return [message(newEmail, data.token_hash)];
  }

  if (!email || !data.token_hash) throw new HookError(400, 'Brak adresu lub tokenu');
  return [message(email, data.token_hash)];
}

export interface SendEmailHookDeps {
  secrets: Buffer[];
  inviteTemplate: string;
  now: () => number;
  origin: () => string | null;
  send: (email: AuthEmail, idempotencyKey: string) => Promise<void>;
}

/** Domyślne zależności: sekrety z env, szablon z obrazu, wysyłka przez Resend z ustawień biura. */
export function defaultHookDeps(env: Record<string, string | undefined>, appRoot: string): SendEmailHookDeps {
  return {
    secrets: parseHookSecrets(env.GOTRUE_HOOK_SEND_EMAIL_SECRETS),
    inviteTemplate: fs.readFileSync(path.join(appRoot, 'supabase/templates/invite.html'), 'utf8'),
    now: () => Math.floor(Date.now() / 1000),
    origin: configuredInstanceOrigin,
    send: async (email, idempotencyKey) => {
      const [settings, key] = await Promise.all([loadSettings(), loadResendKey()]);
      if (!key || !settings.from_email) {
        throw new HookError(503, 'Wysyłka e-maili wymaga klucza Resend i adresu nadawcy (Integracje → Powiadomienia).');
      }
      const from = settings.from_name ? `${settings.from_name} <${settings.from_email}>` : settings.from_email;
      await sendEmail(
        key,
        { from, to: email.to, subject: email.subject, html: email.html, text: email.text, tags: [{ name: 'auth', value: email.kind }] },
        idempotencyKey,
        'auth',
      );
    },
  };
}

/** Obsługa żądania hooka; zwraca status i treść odpowiedzi dla GoTrue. */
export async function handleSendEmailHook(
  deps: SendEmailHookDeps,
  headers: IncomingHttpHeaders,
  body: Buffer,
): Promise<{ status: number; body: unknown }> {
  try {
    if (deps.secrets.length === 0) throw new HookError(503, 'Hook nieskonfigurowany (GOTRUE_HOOK_SEND_EMAIL_SECRETS)');
    verifyWebhook(deps.secrets, headers, body, deps.now());
    let payload: HookPayload;
    try {
      payload = JSON.parse(body.toString('utf8')) as HookPayload;
    } catch {
      throw new HookError(400, 'Niepoprawny JSON');
    }
    const origin = deps.origin();
    if (!origin) throw new HookError(503, 'Brak adresu instancji (OAUTH_ISSUER)');
    const emails = buildAuthEmails(payload, origin, deps.inviteTemplate);
    const webhookId = header(headers, 'webhook-id');
    for (const [i, email] of emails.entries()) {
      await deps.send(email, `auth-${webhookId}-${i}`.slice(0, 256));
    }
    return { status: 200, body: {} };
  } catch (err) {
    const status = err instanceof HookError ? err.status : 500;
    const message = err instanceof HookError ? err.message : 'Nie udało się wysłać wiadomości';
    // Bez adresów i tokenów w logu: tylko kod i komunikat techniczny.
    console.error(`[auth-hook] ${status}: ${message}${err instanceof HookError ? '' : ` (${err instanceof Error ? err.name : typeof err})`}`);
    return { status, body: { error: { http_code: status, message } } };
  }
}

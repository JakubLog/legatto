// /api/notifications - powiadomienia e-mail (Resend) i web push (PWA).
// E-mail tylko przy INSTANCE_EMAIL=on (operator instancji); przy off email_enabled jest zapisywane,
// ale pomijane - kolejka oznacza e-mail jako skipped, push działa bez zmian.
//
// Sesja Supabase (aal2, aktywne konto) w nagłówku Authorization:
//   GET  ?op=status         dostępność kanałów w instancji + publiczny klucz VAPID (każda rola)
//   POST ?op=test           { channel: 'email' | 'push' } - test do siebie, 1/min na kanał (każda rola)
//   GET  ?op=admin_status   ustawienia, klucz Resend, weryfikacja klucza, stan wysyłki (Poseł/administrator)
//   POST ?op=admin_save     zmiana ustawień instancji (Poseł/administrator)
// Adres wysyłki natychmiastowej (pg_net) rejestruje serwer z konfiguracji operatora
// (NOTIFICATIONS_DISPATCH_URL / adres instancji), nigdy z ustawień ani nagłówków żądania.
// Token wysyłki (notification_server_config.dispatch_token) w nagłówku Authorization:
//   POST ?op=dispatch       opróżnienie kolejki - wołane przez pg_net po wstawieniu powiadomień
//
// Treści powiadomień, klucz Resend i klucze VAPID nie trafiają do przeglądarki.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { isPoselRole, loadAuthProfile, parseBearer } from './_lib/auth.js';
import { resolveIssuer } from './_lib/issuer.js';
import { isAal2Session } from './_lib/jwt.js';
import { getAnonClient, getServiceClient } from './_lib/supabase.js';
import { DbError, errorSummary } from './_lib/log-safe.js';
import { instanceFlags } from './_lib/instance.js';
import { deliver, dispatchPending, finalize, loadDispatchContext, OutboxRow } from './_lib/notifications/dispatch.js';
import { countPushDevices } from './_lib/notifications/push.js';
import { checkKey } from './_lib/notifications/resend.js';
import {
  ensureVapidKeys,
  instanceOrigin,
  loadResendKey,
  loadServerConfig,
  loadSettings,
  mergeSettings,
  SETTINGS_KEY,
  SettingsValidationError,
  syncDispatchRegistration,
} from './_lib/notifications/settings.js';

const DISPATCH_BUDGET_MS = 25_000;

class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface SessionUser {
  id: string;
  token: string;
  role: string;
  email: string | null;
}

async function authenticateUser(req: VercelRequest): Promise<SessionUser> {
  const token = parseBearer(req.headers.authorization);
  if (!token) throw new ApiError(401, 'brak_sesji', 'Brak sesji');
  const { data, error } = await getAnonClient().auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, 'brak_sesji', 'Nieprawidłowa lub wygasła sesja');
  if (!isAal2Session(token, data.user)) throw new ApiError(403, 'wymagane_2fa', 'Wymagana weryfikacja dwuetapowa (2FA)');
  const profile = await loadAuthProfile(data.user.id);
  if (!profile?.is_active) throw new ApiError(403, 'konto_nieaktywne', 'Konto jest nieaktywne');
  return { id: data.user.id, token, role: profile.role, email: profile.email ?? data.user.email ?? null };
}

function requireAdmin(user: SessionUser) {
  if (!isPoselRole(user.role)) throw new ApiError(403, 'brak_uprawnien', 'Tylko Poseł lub administrator');
}

function requestOrigin(req: VercelRequest): string | null {
  try {
    return resolveIssuer(req);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Operacje
// ---------------------------------------------------------------------------

async function handleStatus() {
  const ctx = await loadDispatchContext();
  return {
    email: { available: ctx.emailAvailable },
    push: { available: ctx.pushAvailable, vapid_public_key: ctx.vapid?.publicKey ?? null },
  };
}

const TestBody = z.object({ channel: z.enum(['email', 'push']) });

async function handleTest(user: SessionUser, body: unknown) {
  const parsed = TestBody.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'bledne_dane', 'Kanał testu: email albo push');
  const { channel } = parsed.data;
  const ctx = await loadDispatchContext();
  if (channel === 'email') {
    if (!instanceFlags().email) throw new ApiError(409, 'email_wylaczony', 'Wysyłka e-mail jest wyłączona przez operatora instancji.');
    if (!ctx.emailAvailable) throw new ApiError(409, 'nieskonfigurowane', 'Wysyłka e-mail nie jest skonfigurowana w biurze.');
    if (!user.email) throw new ApiError(422, 'brak_adresu', 'Twój profil nie ma adresu e-mail.');
  } else {
    if (!ctx.pushAvailable) throw new ApiError(409, 'nieskonfigurowane', 'Powiadomienia push są wyłączone w biurze.');
    if ((await countPushDevices(user.id)) === 0) {
      throw new ApiError(422, 'brak_urzadzen', 'Włącz powiadomienia push na tym urządzeniu.');
    }
  }

  // Wiersz od razu 'sending' (pg_net i cron go nie podejmą); minuta w kluczu = limit 1/min.
  const minute = new Date().toISOString().slice(0, 16);
  const inserted = await getServiceClient()
    .from('notification_outbox')
    .insert({
      user_id: user.id,
      kind: 'test',
      payload: { channel },
      dedupe_key: `${channel}:${minute}`,
      want_email: channel === 'email',
      want_push: channel === 'push',
      status: 'sending',
      attempts: 1,
      locked_until: new Date(Date.now() + 3 * 60_000).toISOString(),
    })
    .select('id, user_id, kind, payload, want_email, want_push, email_status, push_status, attempts')
    .single();
  if (inserted.error) {
    if (inserted.error.code === '23505') throw new ApiError(429, 'limit', 'Kolejny test za minutę.');
    throw new DbError(inserted.error, 'notification_outbox');
  }
  const row = OutboxRow.parse(inserted.data);
  const outcome = await deliver(row, { id: user.id, email: user.email, full_name: null, is_active: true }, ctx);
  // Test się nie ponawia - błąd od razu wraca do użytkownika.
  const finalOutcome = outcome.email === 'retry' ? { ...outcome, email: 'failed' as const } : outcome;
  await finalize(row, finalOutcome);

  if (channel === 'email') {
    if (finalOutcome.email !== 'sent') throw new ApiError(502, 'blad_dostawcy', finalOutcome.error ?? 'Nie udało się wysłać wiadomości.');
    return { ok: true, email: 'sent' };
  }
  const push = finalOutcome.pushResult ?? { sent: 0, failed: 0 };
  if (push.sent === 0) throw new ApiError(502, 'blad_dostawcy', finalOutcome.error ?? 'Żadne urządzenie nie przyjęło powiadomienia.');
  return { ok: true, push };
}

const AdminOverview = z.object({
  pg_net: z.boolean(),
  pending: z.number(),
  failed_24h: z.number(),
  sent_7d: z.number(),
});

async function handleAdminStatus(user: SessionUser) {
  requireAdmin(user);
  // INSTANCE_EMAIL=off: bez odczytu klucza i bez weryfikacji w Resend (panel e-mail jest ukryty).
  const emailOn = instanceFlags().email;
  const [settings, key, overviewRes] = await Promise.all([
    loadSettings(),
    emailOn ? loadResendKey() : Promise.resolve(''),
    getServiceClient().rpc('notifications_admin_overview'),
  ]);
  if (overviewRes.error) throw new DbError(overviewRes.error, 'notifications_admin_overview');
  const overview = AdminOverview.parse(overviewRes.data);
  // Rejestracja (albo poprawka po zmianie domeny) przy każdym podglądzie panelu - adres tylko z env.
  const registered = await syncDispatchRegistration();
  return {
    settings,
    key: { configured: Boolean(key), hint: key ? `••••${key.slice(-4)}` : null },
    resend: key ? await checkKey(key) : null,
    dispatch: { registered, pg_net: overview.pg_net },
    stats: { pending: overview.pending, failed_24h: overview.failed_24h, sent_7d: overview.sent_7d },
  };
}

async function handleAdminSave(req: VercelRequest, user: SessionUser) {
  requireAdmin(user);
  const current = await loadSettings();
  let next;
  try {
    next = mergeSettings(current, req.body, instanceOrigin(), requestOrigin(req));
  } catch (err) {
    if (err instanceof SettingsValidationError) throw new ApiError(400, 'bledne_dane', err.message);
    throw err;
  }
  // Zapis klientem z sesją użytkownika: RLS (Poseł/administrator + aal2) i audyt setting.update z aktorem.
  const asUser = getAnonClient(user.token);
  const { error } = await asUser
    .from('app_settings')
    .upsert({ key: SETTINGS_KEY, value: next, updated_by: user.id, updated_at: new Date().toISOString() });
  if (error) {
    if (error.code === '42501') throw new ApiError(403, 'brak_uprawnien', 'Brak uprawnień do zmiany ustawień');
    throw new DbError(error, 'app_settings');
  }
  await syncDispatchRegistration();
  if (next.push_enabled) await ensureVapidKeys();
  return { settings: next };
}

async function handleDispatch(req: VercelRequest) {
  const config = await loadServerConfig();
  const expected = config?.dispatch_token;
  const provided = parseBearer(req.headers.authorization) ?? '';
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected ?? '').digest();
  if (!expected || !timingSafeEqual(a, b)) throw new ApiError(401, 'brak_sesji', 'Unauthorized');
  return dispatchPending(Date.now() + DISPATCH_BUDGET_MS);
}

// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  // req.url zamiast req.query - adapter w vite.config.ts (pnpm dev) nie ustawia query.
  const op = new URL(req.url ?? '', 'http://localhost').searchParams.get('op') ?? '';
  try {
    if (op === 'dispatch') {
      if (req.method !== 'POST') throw new ApiError(405, 'metoda', 'Method not allowed');
      return res.status(200).json(await handleDispatch(req));
    }
    const getOps: Record<string, true> = { status: true, admin_status: true };
    const postOps: Record<string, true> = { test: true, admin_save: true };
    if (!Object.hasOwn(getOps, op) && !Object.hasOwn(postOps, op)) throw new ApiError(404, 'nieznana_operacja', 'Nieznana operacja');
    const expectedMethod = Object.hasOwn(getOps, op) ? 'GET' : 'POST';
    if (req.method !== expectedMethod) throw new ApiError(405, 'metoda', 'Method not allowed');

    const user = await authenticateUser(req);
    switch (op) {
      case 'status':
        return res.status(200).json(await handleStatus());
      case 'test':
        return res.status(200).json(await handleTest(user, req.body));
      case 'admin_status':
        return res.status(200).json(await handleAdminStatus(user));
      default:
        return res.status(200).json(await handleAdminSave(req, user));
    }
  } catch (err) {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.code, message: err.message });
    console.error('[notifications] error', op, errorSummary(err));
    return res.status(500).json({ error: 'blad_serwera', message: 'Błąd serwera powiadomień' });
  }
}

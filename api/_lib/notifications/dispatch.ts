// Wysyłka kolejki notification_outbox: odbiór paczek (notifications_claim, skip locked),
// render, e-mail przez Resend, push przez VAPID, zapis wyniku. E-mail ponawiany z odstępem
// (najwyżej MAX_ATTEMPTS prób), push bez ponowień (best-effort, wysyłany raz).

import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { getServiceClient } from '../supabase.js';
import { DbError, errorSummary } from '../log-safe.js';
import { instanceFlags } from '../instance.js';
import { getSiteIdentity, mpForms, officeFullName } from '../siteIdentity.js';
import { ResendError, sendEmail } from './resend.js';
import { sendPushToUser, type PushResult } from './push.js';
import { ensureVapidKeys, loadResendKey, loadSettings, type NotificationsSettings, type VapidKeys } from './settings.js';
import { renderNotification, type RenderContext } from './templates.js';

const CLAIM_BATCH = 20;
const MAX_ATTEMPTS = 5;
// Odstęp przed kolejną próbą po n-tej nieudanej (minuty).
const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
// Domyślny limit Resend to kilka zapytań na sekundę na zespół.
const EMAIL_SPACING_MS = 550;

export const OutboxRow = z
  .object({
    id: z.string(),
    user_id: z.string(),
    kind: z.string(),
    payload: z.unknown(),
    want_email: z.boolean(),
    want_push: z.boolean(),
    email_status: z.string().nullable(),
    push_status: z.string().nullable(),
    attempts: z.number(),
  })
  .loose();
export type OutboxRow = z.infer<typeof OutboxRow>;

const Recipient = z.object({
  id: z.string(),
  email: z.string().nullable(),
  full_name: z.string().nullable(),
  is_active: z.boolean(),
});
type Recipient = z.infer<typeof Recipient>;

export interface DispatchContext {
  settings: NotificationsSettings;
  resendKey: string;
  emailAvailable: boolean;
  pushAvailable: boolean;
  vapid: VapidKeys | null;
  from: string;
  vapidSubject: string;
  render: RenderContext;
}

export async function loadDispatchContext(): Promise<DispatchContext> {
  // INSTANCE_EMAIL=off: e-mail niedostępny niezależnie od email_enabled (zapisane, ale pomijane),
  // bez odczytu klucza Resend. INSTANCE_PUSH=off (VPS bez zgody admina na egress do usług push):
  // push niedostępny tak samo. Kanały są od siebie niezależne.
  const { email: emailOn, push: pushOn } = instanceFlags();
  const [settings, resendKey, identity] = await Promise.all([
    loadSettings(),
    emailOn ? loadResendKey() : Promise.resolve(''),
    getSiteIdentity(),
  ]);
  // loadSettings: adres instancji z konfiguracji, wartość z bazy tylko bez niej (lokalnie).
  const appUrl = settings.app_url;
  const officeName = officeFullName(identity);
  const emailAvailable =
    emailOn && settings.email_enabled && Boolean(resendKey) && Boolean(settings.from_email) && Boolean(appUrl);
  const vapid = pushOn && settings.push_enabled ? await ensureVapidKeys() : null;
  const fromName = (settings.from_name || officeName).replace(/[\r\n<>"]/g, ' ').trim();
  return {
    settings,
    resendKey,
    emailAvailable,
    pushAvailable: pushOn && settings.push_enabled && vapid !== null,
    vapid,
    from: `${fromName} <${settings.from_email}>`,
    vapidSubject: appUrl.startsWith('https://')
      ? appUrl
      : `mailto:${settings.from_email || settings.reply_to || 'powiadomienia@localhost'}`,
    render: { officeName, appUrl, includeTitles: settings.include_titles, mp: mpForms(identity.mp_gender) },
  };
}

type ChannelStatus = 'sent' | 'failed' | 'skipped';

export interface Outcome {
  email: ChannelStatus | 'retry' | null;
  push: ChannelStatus | null;
  pushResult?: PushResult;
  emailId?: string;
  error?: string;
  retryAfterSeconds?: number;
  rateLimited?: boolean;
}

async function loadRecipients(userIds: string[]): Promise<Map<string, Recipient>> {
  const { data, error } = await getServiceClient()
    .from('profiles')
    .select('id, email, full_name, is_active')
    .in('id', [...new Set(userIds)]);
  if (error) throw new DbError(error, 'profiles');
  const parsed = z.array(Recipient).parse(data ?? []);
  return new Map(parsed.map((r) => [r.id, r]));
}

/** Dostarcza jeden wiersz. Push wysyłany tylko przy pierwszej próbie (push_status pusty). */
export async function deliver(row: OutboxRow, recipient: Recipient | undefined, ctx: DispatchContext): Promise<Outcome> {
  if (!recipient?.is_active) return { email: row.want_email ? 'skipped' : null, push: row.want_push ? 'skipped' : null, error: 'Konto nieaktywne' };
  const rendered = renderNotification(row.kind, row.payload, ctx.render);
  const outcome: Outcome = { email: null, push: null };

  if (row.want_push && !row.push_status) {
    if (!ctx.pushAvailable || !ctx.vapid) {
      outcome.push = 'skipped';
    } else {
      try {
        const result = await sendPushToUser(row.user_id, rendered.push, ctx.vapid, ctx.vapidSubject);
        outcome.pushResult = result;
        outcome.push = result.sent > 0 ? 'sent' : result.failed > 0 ? 'failed' : 'skipped';
        if (outcome.push === 'failed') outcome.error = 'Push: żadne urządzenie nie przyjęło powiadomienia';
        // Zapis od razu: gdy wywołanie padnie przy e-mailu, ponowienie nie wyśle push drugi raz.
        if (row.want_email) {
          await getServiceClient().from('notification_outbox').update({ push_status: outcome.push }).eq('id', row.id);
        }
      } catch (err) {
        outcome.push = 'failed';
        outcome.error = err instanceof Error ? err.message : 'Push: błąd';
      }
    }
  } else if (row.want_push) {
    outcome.push = row.push_status === 'sent' || row.push_status === 'failed' || row.push_status === 'skipped' ? row.push_status : null;
  }

  if (row.want_email) {
    const to = recipient.email?.trim();
    if (!ctx.emailAvailable) {
      outcome.email = 'skipped';
    } else if (!to) {
      outcome.email = 'skipped';
      outcome.error = 'Brak adresu e-mail w profilu';
    } else {
      try {
        outcome.emailId = await sendEmail(
          ctx.resendKey,
          {
            from: ctx.from,
            to,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            replyTo: ctx.settings.reply_to || undefined,
            tags: [{ name: 'kind', value: row.kind.replace(/[^A-Za-z0-9_-]/g, '_') }],
          },
          `notification-${row.id}`,
        );
        outcome.email = 'sent';
      } catch (err) {
        // Każdy błąd wysyłki kończy się tutaj - push_status z tej próby nie może przepaść.
        const resendError = err instanceof ResendError ? err : null;
        if (!resendError) console.error('[notifications] email error', errorSummary(err));
        outcome.error = resendError ? `${resendError.code}: ${resendError.message}`.slice(0, 500) : 'Błąd wewnętrzny wysyłki e-mail';
        outcome.rateLimited = resendError?.status === 429;
        outcome.retryAfterSeconds = resendError?.retryAfter ?? undefined;
        outcome.email = (resendError ? resendError.retryable : true) && row.attempts < MAX_ATTEMPTS ? 'retry' : 'failed';
      }
    }
  }
  return outcome;
}

/** Zapis wyniku wiersza: ponowienie e-maila albo stan końcowy. */
export async function finalize(row: OutboxRow, outcome: Outcome): Promise<'sent' | 'failed' | 'skipped' | 'retry'> {
  const supabase = getServiceClient();
  const now = new Date();
  if (outcome.email === 'retry') {
    const minutes = outcome.rateLimited && outcome.retryAfterSeconds
      ? outcome.retryAfterSeconds / 60
      : BACKOFF_MINUTES[Math.min(row.attempts, BACKOFF_MINUTES.length) - 1] ?? 60;
    const { error } = await supabase
      .from('notification_outbox')
      .update({
        status: 'pending',
        // Limit zapytań nie jest nieudaną próbą.
        attempts: outcome.rateLimited ? Math.max(0, row.attempts - 1) : row.attempts,
        next_attempt_at: new Date(now.getTime() + minutes * 60_000).toISOString(),
        locked_until: null,
        // Brak wyniku push w tej próbie (błąd przed wysyłką) nie kasuje wyniku z poprzedniej.
        ...(outcome.push ? { push_status: outcome.push } : {}),
        last_error: outcome.error ?? null,
      })
      .eq('id', row.id);
    if (error) console.error('[notifications] outbox update error', error.code);
    return 'retry';
  }
  const channels = [outcome.email, outcome.push].filter((c): c is ChannelStatus => c !== null);
  const status = channels.includes('failed') ? 'failed' : channels.includes('sent') ? 'sent' : 'skipped';
  const { error } = await supabase
    .from('notification_outbox')
    .update({
      status,
      email_status: outcome.email,
      ...(outcome.push ? { push_status: outcome.push } : {}),
      email_id: outcome.emailId || null,
      last_error: outcome.error ?? null,
      locked_until: null,
      sent_at: status === 'sent' ? now.toISOString() : null,
    })
    .eq('id', row.id);
  if (error) console.error('[notifications] outbox update error', error.code);
  return status;
}

/** Odbiór nieprzetworzonych wierszy z powrotem do kolejki (koniec czasu wywołania). */
async function release(rows: OutboxRow[]): Promise<void> {
  await Promise.all(
    rows.map((row) =>
      getServiceClient()
        .from('notification_outbox')
        .update({ status: 'pending', attempts: Math.max(0, row.attempts - 1), locked_until: null })
        .eq('id', row.id)
        .eq('status', 'sending'),
    ),
  );
}

export interface DispatchSummary {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  retry: number;
}

/** Opróżnia kolejkę do `deadline` (ms epoki). Kolejne paczki aż do pustej kolejki albo limitu zapytań. */
export async function dispatchPending(deadline: number): Promise<DispatchSummary> {
  const summary: DispatchSummary = { processed: 0, sent: 0, failed: 0, skipped: 0, retry: 0 };
  const supabase = getServiceClient();
  let ctx: DispatchContext | null = null;

  while (Date.now() < deadline - 3000) {
    const claimed = await supabase.rpc('notifications_claim', { p_limit: CLAIM_BATCH });
    if (claimed.error) throw new DbError(claimed.error, 'notifications_claim');
    const rows = z.array(OutboxRow).parse(claimed.data ?? []);
    if (rows.length === 0) break;
    let recipients: Map<string, Recipient>;
    try {
      ctx ??= await loadDispatchContext();
      recipients = await loadRecipients(rows.map((r) => r.user_id));
    } catch (err) {
      // Bez tego wiersze czekałyby na wygaśnięcie blokady z naliczoną próbą.
      await release(rows);
      throw err;
    }

    let stop = false;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (stop || Date.now() >= deadline - 3000) {
        await release(rows.slice(i));
        stop = true;
        break;
      }
      let outcome: Outcome;
      try {
        outcome = await deliver(row, recipients.get(row.user_id), ctx);
      } catch (err) {
        console.error('[notifications] deliver error', errorSummary(err));
        outcome = { email: row.attempts < MAX_ATTEMPTS ? 'retry' : 'failed', push: null, error: 'Błąd wewnętrzny wysyłki' };
      }
      const result = await finalize(row, outcome);
      summary.processed += 1;
      summary[result] += 1;
      if (outcome.rateLimited) {
        await release(rows.slice(i + 1));
        stop = true;
        break;
      }
      if (outcome.email === 'sent' || outcome.email === 'retry') await sleep(EMAIL_SPACING_MS);
    }
    if (stop) break;
  }
  return summary;
}

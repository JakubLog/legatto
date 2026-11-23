// Web push (VAPID) na urządzenia użytkownika z push_subscriptions. Treść bez danych spraw
// (ekran blokady), tylko tytuł rodzaju i link do portalu.

import webpush from 'web-push';
import { getServiceClient } from '../supabase.js';
import { DbError, errorSummary } from '../log-safe.js';
import type { VapidKeys } from './settings.js';

// Te same usługi co CHECK w push_subscriptions - druga linia obrony przed SSRF.
const PUSH_ENDPOINT_RE =
  /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\//;

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PushResult {
  sent: number;
  failed: number;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
}

function allowedEndpoint(endpoint: string): boolean {
  return PUSH_ENDPOINT_RE.test(endpoint);
}

export async function sendPushToUser(
  userId: string,
  message: PushMessage,
  vapid: VapidKeys,
  subject: string,
): Promise<PushResult> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failure_count')
    .eq('user_id', userId);
  if (error) throw new DbError(error, 'push_subscriptions');
  const rows = (data ?? []) as SubscriptionRow[];
  const result: PushResult = { sent: 0, failed: 0 };
  const payload = JSON.stringify(message);

  await Promise.all(
    rows.map(async (row) => {
      if (!allowedEndpoint(row.endpoint)) {
        result.failed += 1;
        await supabase.from('push_subscriptions').delete().eq('id', row.id);
        return;
      }
      try {
        await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, {
          vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
          TTL: 24 * 60 * 60,
          urgency: 'normal',
          timeout: 10_000,
        });
        result.sent += 1;
        await supabase
          .from('push_subscriptions')
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq('id', row.id);
      } catch (err) {
        result.failed += 1;
        const status = err instanceof webpush.WebPushError ? err.statusCode : undefined;
        // 404/410 = subskrypcja wygasła albo odwołana w przeglądarce.
        if (status === 404 || status === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', row.id);
        } else {
          console.error('[notifications] push error', errorSummary(err));
          await supabase
            .from('push_subscriptions')
            .update({ failure_count: Math.min(row.failure_count + 1, 100) })
            .eq('id', row.id);
        }
      }
    }),
  );
  return result;
}

export async function countPushDevices(userId: string): Promise<number> {
  const { count, error } = await getServiceClient()
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw new DbError(error, 'push_subscriptions');
  return count ?? 0;
}

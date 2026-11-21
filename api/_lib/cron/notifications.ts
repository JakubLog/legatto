// Zadanie notifications (codziennie rano): terminy spraw, plan dnia,
// podsumowania tygodnia (notifications_enqueue_daily) i wysyłka całej kolejki - także
// zaległej, gdy natychmiastowa wysyłka przez pg_net nie zadziałała. Przy okazji rejestracja
// adresu wysyłki z konfiguracji (np. po wdrożeniu albo zmianie domeny).
// INSTANCE_EMAIL=off: kolejka idzie dalej (push), e-maile dostają email_status 'skipped'
// w dispatchPending/loadDispatchContext - bez zapytań do Resend.
import { getServiceClient } from '../supabase.js';
import { dispatchPending } from '../notifications/dispatch.js';
import { syncDispatchRegistration } from '../notifications/settings.js';
import type { CronJobResult } from './types.js';

export async function runNotifications(): Promise<CronJobResult> {
  const startedAt = Date.now();
  await syncDispatchRegistration().catch((err: unknown) => {
    console.error('[cron notifications] dispatch registration error', err instanceof Error ? err.message : err);
  });
  const { data: enqueued, error } = await getServiceClient().rpc('notifications_enqueue_daily', { p_today: null });
  if (error) console.error('[cron notifications] enqueue error', error.code, error.message);
  try {
    const dispatched = await dispatchPending(startedAt + 100_000);
    return { status: error ? 500 : 200, body: { enqueued: error ? null : enqueued, dispatched } };
  } catch (err) {
    console.error('[cron notifications] dispatch error', err instanceof Error ? err.message : err);
    return { status: 500, body: { enqueued: error ? null : enqueued, error: 'Dispatch failed' } };
  }
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { SECRET_SETTINGS_STATUS_KEY, saveSecretSetting } from '@/hooks/useSecretSettings';
import type {
  ChannelPrefs,
  NotificationDelivery,
  NotificationKind,
  NotificationPreferences,
  NotificationsAdminStatus,
  NotificationsSettings,
  NotificationsStatus,
  PushDevice,
} from '@/lib/notifications';
import {
  currentPushSubscription,
  pushPermission,
  pushSupport,
  subscribePush,
  unsubscribePush,
  type PushSupport,
} from '@/lib/pushSubscription';

export const NOTIFICATIONS_STATUS_KEY = ['notifications', 'status'] as const;
export const NOTIFICATION_PREFERENCES_KEY = ['notifications', 'preferences'] as const;
export const PUSH_DEVICES_KEY = ['notifications', 'push-devices'] as const;
export const THIS_DEVICE_PUSH_KEY = ['notifications', 'this-device'] as const;
export const NOTIFICATIONS_ADMIN_STATUS_KEY = ['notifications', 'admin-status'] as const;
export const NOTIFICATION_DELIVERIES_KEY = ['notifications', 'deliveries'] as const;

// ---------------------------------------------------------------------------
// /api/notifications

export class NotificationsApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'NotificationsApiError';
    this.status = status;
    this.code = code;
  }
}

const SESSION_EXPIRED = 'Sesja wygasła. Zaloguj się ponownie.';

/** Wywołanie API z sesją Supabase; po 401 odświeża sesję raz. */
async function notificationsApi<T>(op: string, body?: unknown): Promise<T> {
  let refreshed = false;
  for (;;) {
    const { data } = refreshed ? await supabase.auth.refreshSession() : await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new NotificationsApiError(401, SESSION_EXPIRED);
    const res = await fetch(`/api/notifications?op=${op}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      continue;
    }
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
      const message =
        typeof payload?.message === 'string' && payload.message
          ? payload.message
          : res.status === 401
            ? SESSION_EXPIRED
            : `Błąd serwera (${res.status})`;
      throw new NotificationsApiError(res.status, message, typeof payload?.error === 'string' ? payload.error : undefined);
    }
    return (await res.json()) as T;
  }
}

export function useNotificationsStatus() {
  return useQuery<NotificationsStatus>({
    queryKey: NOTIFICATIONS_STATUS_KEY,
    queryFn: () => notificationsApi<NotificationsStatus>('status'),
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Preferencje użytkownika

export function useMyNotificationPreferences() {
  return useQuery<NotificationPreferences>({
    queryKey: NOTIFICATION_PREFERENCES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_notification_preferences');
      if (error) throw error;
      return data as NotificationPreferences;
    },
  });
}

export interface NotificationPreferencesPatch {
  email_enabled?: boolean;
  push_enabled?: boolean;
  weekly_digest_day?: number;
  kinds?: Partial<Record<NotificationKind, Partial<ChannelPrefs>>>;
}

/** Zapis częściowy (NULL = bez zmian po stronie DB), optymistycznie w cache. */
export function useSaveMyNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: NotificationPreferencesPatch) => {
      const { error } = await supabase.rpc('set_my_notification_preferences', {
        p_email_enabled: patch.email_enabled ?? null,
        p_push_enabled: patch.push_enabled ?? null,
        p_weekly_digest_day: patch.weekly_digest_day ?? null,
        p_kinds: patch.kinds ?? null,
      });
      if (error) throw error;
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: NOTIFICATION_PREFERENCES_KEY });
      const previous = qc.getQueryData<NotificationPreferences>(NOTIFICATION_PREFERENCES_KEY);
      if (previous) {
        const kinds = { ...previous.kinds };
        for (const [kind, channels] of Object.entries(patch.kinds ?? {}) as [NotificationKind, Partial<ChannelPrefs>][]) {
          const current = kinds[kind];
          if (current) kinds[kind] = { ...current, ...channels };
        }
        qc.setQueryData<NotificationPreferences>(NOTIFICATION_PREFERENCES_KEY, {
          email_enabled: patch.email_enabled ?? previous.email_enabled,
          push_enabled: patch.push_enabled ?? previous.push_enabled,
          weekly_digest_day: patch.weekly_digest_day ?? previous.weekly_digest_day,
          kinds,
        });
      }
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) qc.setQueryData(NOTIFICATION_PREFERENCES_KEY, context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATION_PREFERENCES_KEY }),
  });
}

// ---------------------------------------------------------------------------
// Urządzenia push

export function useMyPushDevices() {
  return useQuery<PushDevice[]>({
    queryKey: PUSH_DEVICES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, user_agent, created_at, last_success_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PushDevice[];
    },
  });
}

export interface ThisDevicePush {
  support: PushSupport;
  permission: NotificationPermission;
  /** Endpoint subskrypcji w tej przeglądarce; null = brak. */
  endpoint: string | null;
}

/** Stan push w tej przeglądarce (odświeżany po powrocie do karty - zgoda mogła się zmienić). */
export function useThisDevicePush() {
  return useQuery<ThisDevicePush>({
    queryKey: THIS_DEVICE_PUSH_KEY,
    queryFn: async () => {
      const support = await pushSupport();
      const subscription = support === 'ready' ? await currentPushSubscription() : null;
      return { support, permission: pushPermission(), endpoint: subscription?.endpoint ?? null };
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

function useInvalidatePushState() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: THIS_DEVICE_PUSH_KEY }),
      qc.invalidateQueries({ queryKey: PUSH_DEVICES_KEY }),
    ]);
}

export function useEnableThisDevicePush() {
  const invalidate = useInvalidatePushState();
  return useMutation({
    mutationFn: (vapidPublicKey: string) => subscribePush(vapidPublicKey),
    onSettled: invalidate,
  });
}

export function useDisableThisDevicePush() {
  const invalidate = useInvalidatePushState();
  return useMutation({
    mutationFn: unsubscribePush,
    onSettled: invalidate,
  });
}

/** Usuwa urządzenie z listy; gdy to ta przeglądarka, wypisuje też jej subskrypcję. */
export function useRemovePushDevice() {
  const invalidate = useInvalidatePushState();
  return useMutation({
    mutationFn: async (endpoint: string) => {
      const { error } = await supabase.rpc('remove_my_push_subscription', { p_endpoint: endpoint });
      if (error) throw error;
      const subscription = await currentPushSubscription().catch(() => null);
      if (subscription?.endpoint === endpoint) await subscription.unsubscribe().catch(() => undefined);
    },
    onSettled: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Test

export type TestChannel = 'email' | 'push';

export interface TestResult {
  ok: true;
  email?: 'sent';
  push?: { sent: number; failed: number };
}

const TEST_ERRORS: Record<string, string> = {
  nieskonfigurowane: 'Ten kanał jest wyłączony w ustawieniach biura.',
  brak_adresu: 'Twój profil nie ma adresu e-mail.',
  brak_urzadzen: 'Najpierw włącz powiadomienia push na tym urządzeniu.',
  limit: 'Test można wysłać raz na minutę. Spróbuj za chwilę.',
};

/** Komunikat do toasta dla błędu testu (blad_dostawcy: treść od dostawcy). */
export function testErrorMessage(err: unknown): string {
  if (err instanceof NotificationsApiError) {
    if (err.code && TEST_ERRORS[err.code]) return TEST_ERRORS[err.code];
    if (err.code === 'blad_dostawcy') return `Dostawca odrzucił wysyłkę: ${err.message}`;
  }
  return err instanceof Error ? err.message : 'Nieznany błąd';
}

export function useSendTestNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channel: TestChannel) => notificationsApi<TestResult>('test', { channel }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PUSH_DEVICES_KEY });
      void qc.invalidateQueries({ queryKey: NOTIFICATION_DELIVERIES_KEY });
    },
  });
}

// ---------------------------------------------------------------------------
// Administracja (Poseł/Administrator)

export function useNotificationsAdminStatus(enabled = true) {
  return useQuery<NotificationsAdminStatus>({
    queryKey: NOTIFICATIONS_ADMIN_STATUS_KEY,
    queryFn: () => notificationsApi<NotificationsAdminStatus>('admin_status'),
    enabled,
    retry: false,
  });
}

export function useSaveNotificationsSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<NotificationsSettings>) =>
      notificationsApi<{ settings: NotificationsSettings }>('admin_save', patch),
    onSuccess: ({ settings }) => {
      qc.setQueryData<NotificationsAdminStatus>(NOTIFICATIONS_ADMIN_STATUS_KEY, (old) =>
        old ? { ...old, settings } : old,
      );
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_ADMIN_STATUS_KEY });
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_STATUS_KEY });
    },
  });
}

/** Klucz Resend przez set_secret_setting; null / pusty usuwa klucz. */
export function useSaveResendKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: string | null) => saveSecretSetting('resend_api_key', value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SECRET_SETTINGS_STATUS_KEY });
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_ADMIN_STATUS_KEY });
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_STATUS_KEY });
    },
  });
}

export function useNotificationDeliveries(limit = 50) {
  return useQuery<NotificationDelivery[]>({
    queryKey: [...NOTIFICATION_DELIVERIES_KEY, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_notification_deliveries', { p_limit: limit });
      if (error) throw error;
      return (data ?? []) as NotificationDelivery[];
    },
  });
}

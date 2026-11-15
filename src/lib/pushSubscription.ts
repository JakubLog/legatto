import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { isStandalonePwa } from '@/lib/pwa';

// Web push tego urządzenia: subskrypcja w przeglądarce (PushManager z service workera PWA)
// + rejestracja endpointu w DB (register_my_push_subscription). W `pnpm dev` service worker
// jest wyłączony, więc `getRegistration` zwraca undefined -> 'no-service-worker'.

export type PushSupport = 'unsupported' | 'needs-install' | 'no-service-worker' | 'ready';

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS przedstawia się jako Mac
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function hasPushApi(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function getPushRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(undefined);
  return navigator.serviceWorker.getRegistration('/');
}

export async function pushSupport(): Promise<PushSupport> {
  // iOS: web push tylko w aplikacji dodanej do ekranu początkowego (iOS 16.4+).
  if (isIos() && !isStandalonePwa()) return 'needs-install';
  if (!hasPushApi()) return 'unsupported';
  const registration = await getPushRegistration();
  return registration ? 'ready' : 'no-service-worker';
}

/** Uprawnienie do powiadomień; 'default' także gdy API niedostępne. */
export function pushPermission(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'default';
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!hasPushApi()) return null;
  const registration = await getPushRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(current: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (!current || current.byteLength !== expected.byteLength) return false;
  const bytes = new Uint8Array(current);
  return bytes.every((b, i) => b === expected[i]);
}

async function registerOnServer(subscription: PushSubscription): Promise<void> {
  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys.auth) throw new Error('Przeglądarka nie zwróciła kluczy subskrypcji push.');
  const { error } = await supabase.rpc('register_my_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw error;
}

async function removeOnServer(endpoint: string): Promise<void> {
  const { error } = await supabase.rpc('remove_my_push_subscription', { p_endpoint: endpoint });
  if (error) throw error;
}

// Znacznik `<userId>:<endpoint>` ostatniej rejestracji tej przeglądarki. Synchronizacja w tle
// nie rejestruje ponownie tego samego urządzenia tego samego konta - inaczej urządzenie usunięte
// z listy na innym urządzeniu wracałoby przy następnym otwarciu portalu.
const REGISTERED_KEY = 'app.push.registered';

function readMarker(): string | null {
  try {
    return localStorage.getItem(REGISTERED_KEY);
  } catch {
    return null;
  }
}

function writeMarker(value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(REGISTERED_KEY);
    else localStorage.setItem(REGISTERED_KEY, value);
  } catch {
    // tryb prywatny / brak miejsca - najwyżej jedna zbędna rejestracja
  }
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * Włącza push na tym urządzeniu. Wywołuj bezpośrednio z kliknięcia (iOS wymaga gestu
 * użytkownika dla `requestPermission`). Subskrypcja z innym kluczem VAPID jest odnawiana.
 */
export async function subscribePush(vapidPublicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') {
    throw new Error('Powiadomienia są zablokowane w ustawieniach przeglądarki.');
  }
  if (permission !== 'granted') throw new Error('Nie udzielono zgody na powiadomienia.');

  const registration = await getPushRegistration();
  if (!registration) throw new Error('Powiadomienia push działają w wersji produkcyjnej aplikacji.');

  const applicationServerKey = base64UrlToBytes(vapidPublicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, applicationServerKey)) {
    await removeOnServer(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe();
    subscription = null;
  }
  const created = subscription === null;
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  try {
    await registerOnServer(subscription);
  } catch (err) {
    // Subskrypcja bez wiersza na serwerze nic nie dostarcza - nie zostawiamy jej w przeglądarce.
    if (created) await subscription.unsubscribe().catch(() => undefined);
    throw err;
  }
  const userId = await currentUserId();
  writeMarker(userId ? `${userId}:${subscription.endpoint}` : null);
}

/** Wyłącza push na tym urządzeniu (serwer, potem przeglądarka). */
export async function unsubscribePush(): Promise<void> {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  await removeOnServer(subscription.endpoint);
  await subscription.unsubscribe();
  writeMarker(null);
}

/** Przy wylogowaniu: best-effort, nigdy nie rzuca. */
export async function removeThisDevicePush(): Promise<void> {
  try {
    const subscription = await currentPushSubscription();
    if (!subscription) return;
    await Promise.allSettled([removeOnServer(subscription.endpoint), subscription.unsubscribe()]);
    writeMarker(null);
  } catch {
    // brak API / service workera - nic do usunięcia
  }
}

/**
 * Raz na zalogowaną sesję rejestruje istniejącą subskrypcję przeglądarki, gdy zmienił się jej
 * endpoint (`pushsubscriptionchange`, reinstalacja PWA) albo konto na tym urządzeniu.
 */
export function usePushSubscriptionSync(userId: string | undefined): void {
  const syncedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      syncedFor.current = null;
      return;
    }
    if (syncedFor.current === userId) return;
    syncedFor.current = userId;
    if (pushPermission() !== 'granted') return;
    void currentPushSubscription()
      .then(async (subscription) => {
        if (!subscription) return;
        const marker = `${userId}:${subscription.endpoint}`;
        if (readMarker() === marker) return;
        await registerOnServer(subscription);
        writeMarker(marker);
      })
      .catch(() => undefined);
  }, [userId]);
}

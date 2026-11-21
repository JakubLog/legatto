// Zapamiętane profile na tym komputerze (ekran wyboru po wylogowaniu) i zaufanie przeglądarki.
//
// Profil (imię, e-mail, avatar) zostaje w IndexedDB po wylogowaniu. Gdy konto ma PIN trybu
// prywatnego, przeglądarka dostaje też klucz ECDSA P-256 zarejestrowany w bazie
// (register_trusted_device): klucz prywatny jest nieeksportowalny, więc nie da się go skopiować
// na inny komputer. Logowanie z profilu = podpis wyzwania + PIN (Edge Function device-login) ->
// sesja aal1 -> zwykły ekran 2FA. Żadne tokeny sesji nie są tu przechowywane.

import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Profile } from '@/integrations/supabase/types';

export interface TrustedDeviceKey {
  id: string;
  key: CryptoKey;
  expiresAt: string;
}

export interface RememberedProfile {
  userId: string;
  email: string;
  fullName: string;
  avatarSrc: string | null;
  lastUsedAt: number;
  /** null = logowanie z profilu hasłem (brak PIN-u, zaufanie wygasło albo zostało odwołane). */
  device: TrustedDeviceKey | null;
}

const DB_NAME = 'app-remembered-profiles';
const STORE = 'profiles';
const MAX_PROFILES = 12;
/** sessionStorage: wybór "Zapamiętaj mnie" z formularza hasła, przypięty do adresu e-mail. */
const INTENT_KEY = 'app.rememberDevice';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'userId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Profile od ostatnio używanego. Brak IndexedDB (np. tryb prywatny przeglądarki) = pusta lista. */
export async function listRememberedProfiles(): Promise<RememberedProfile[]> {
  try {
    const all = await withStore('readonly', (store) => store.getAll() as IDBRequest<RememberedProfile[]>);
    return all.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  } catch {
    return [];
  }
}

async function putProfile(profile: RememberedProfile): Promise<void> {
  await withStore('readwrite', (store) => store.put(profile));
  const all = await listRememberedProfiles();
  for (const stale of all.slice(MAX_PROFILES)) {
    await withStore('readwrite', (store) => store.delete(stale.userId));
  }
}

export function isDeviceUsable(device: TrustedDeviceKey | null): device is TrustedDeviceKey {
  return device != null && Date.parse(device.expiresAt) > Date.now();
}

/** Zaufanie odwołane albo wygasło: profil zostaje, logowanie z niego wymaga hasła. */
export async function dropDevice(userId: string): Promise<void> {
  const profile = (await listRememberedProfiles()).find((p) => p.userId === userId);
  if (profile?.device) await putProfile({ ...profile, device: null });
}

// ---------------------------------------------------------------------------
// Edge Function device-login
// ---------------------------------------------------------------------------

export type TrustedDeviceErrorCode =
  | 'unknown_device'
  | 'bad_pin'
  | 'pin_locked'
  | 'pin_not_set'
  | 'account_unavailable'
  | 'bad_request'
  | 'server_error';

export class TrustedDeviceError extends Error {
  readonly code: TrustedDeviceErrorCode;
  constructor(code: TrustedDeviceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

async function callDeviceLogin<T>(body: Record<string, string>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('device-login', { body });
  if (error) {
    const payload =
      error instanceof FunctionsHttpError
        ? ((await error.context.json().catch(() => null)) as { error?: string; code?: TrustedDeviceErrorCode } | null)
        : null;
    throw new TrustedDeviceError(payload?.code ?? 'server_error', payload?.error ?? 'Brak połączenia z serwerem. Spróbuj ponownie.');
  }
  if (!data) throw new TrustedDeviceError('server_error', 'Pusta odpowiedź serwera.');
  return data;
}

/** Podpis wyzwania kluczem urządzenia; format tekstu jak w supabase/functions/device-login. */
async function signDeviceChallenge(device: TrustedDeviceKey, op: 'login' | 'forget'): Promise<string> {
  const { challenge } = await callDeviceLogin<{ challenge: string }>({ op: 'challenge', device_id: device.id });
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    device.key,
    new TextEncoder().encode(`legatto-trusted-device|${op}|${device.id}|${challenge}`),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * PIN + klucz urządzenia -> sesja aal1 (ProtectedRoute pokaże ekran 2FA).
 * Urządzenie nieznane / konto bez 2FA lub hasła -> zaufanie zdjęte lokalnie, dalej hasłem.
 */
export async function signInWithTrustedDevice(profile: RememberedProfile, pin: string): Promise<void> {
  if (!isDeviceUsable(profile.device)) {
    throw new TrustedDeviceError('unknown_device', 'Ten komputer nie jest już zaufany. Zaloguj się hasłem.');
  }
  try {
    const signature = await signDeviceChallenge(profile.device, 'login');
    const { token_hash } = await callDeviceLogin<{ token_hash: string }>({
      op: 'login',
      device_id: profile.device.id,
      signature,
      pin,
    });
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
    if (error) throw new TrustedDeviceError('server_error', 'Nie udało się zalogować. Spróbuj ponownie.');
  } catch (err) {
    if (err instanceof TrustedDeviceError && (err.code === 'unknown_device' || err.code === 'account_unavailable')) {
      await dropDevice(profile.userId);
    }
    throw err;
  }
}

/** Usuwa profil z ekranu wyboru (tylko lokalnie, razem z kluczem prywatnym). */
export async function removeRememberedProfile(userId: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(userId));
}

/** Usuwa profil z tego komputera; zaufanie odwołuje też na serwerze (best-effort, podpisem). */
export async function forgetRememberedProfile(profile: RememberedProfile): Promise<void> {
  await removeRememberedProfile(profile.userId);
  if (!isDeviceUsable(profile.device)) return;
  try {
    const signature = await signDeviceChallenge(profile.device, 'forget');
    await callDeviceLogin({ op: 'forget', device_id: profile.device.id, signature });
  } catch {
    // Klucz prywatny jest już usunięty - wpis na serwerze nie da się użyć i wygaśnie sam.
  }
}

// ---------------------------------------------------------------------------
// Zapamiętanie po zalogowaniu (aal2)
// ---------------------------------------------------------------------------

export function setRememberIntent(email: string, remember: boolean): void {
  try {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify({ email: email.trim().toLowerCase(), remember }));
  } catch {
    // sessionStorage niedostępny - bez zapamiętania
  }
}

/** Jednorazowy odczyt wyboru z formularza hasła; wybór innego konta niż zalogowane jest pomijany. */
function takeRememberIntent(email: string): boolean | null {
  try {
    const raw = sessionStorage.getItem(INTENT_KEY);
    sessionStorage.removeItem(INTENT_KEY);
    const intent = raw ? (JSON.parse(raw) as { email?: unknown; remember?: unknown }) : null;
    if (intent?.email !== email.trim().toLowerCase() || typeof intent.remember !== 'boolean') return null;
    return intent.remember;
  } catch {
    return null;
  }
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Przeglądarka';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return os ? `${browser} · ${os}` : browser;
}

async function registerThisDevice(replaces: string | null): Promise<TrustedDeviceKey> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const { data, error } = await supabase.rpc('register_trusted_device', {
    p_public_key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    p_label: deviceLabel(),
    p_replaces: replaces,
  });
  if (error) throw error;
  const result = data as { id: string; expires_at: string };
  return { id: result.id, key: pair.privateKey, expiresAt: result.expires_at };
}

let syncQueue: Promise<void> = Promise.resolve();

/**
 * Po wejściu do portalu (aal2): aktualizuje zapamiętany profil i zaufanie przeglądarki.
 * - "Zapamiętaj mnie" odznaczone przy logowaniu hasłem -> profil i zaufanie usunięte;
 * - zaznaczone -> nowy klucz (30 dni od tego logowania hasłem);
 * - bez wyboru (logowanie z profilu, odświeżenie karty) -> tylko dane profilu, klucz gdy go brak;
 * - konto bez PIN-u -> profil bez zaufania (logowanie z profilu hasłem).
 * Wywołania kolejkowane - równoległe efekty nie rejestrują dwóch kluczy.
 */
export function syncRememberedProfile(profile: Profile): Promise<void> {
  syncQueue = syncQueue
    .then(async () => {
      const intent = takeRememberIntent(profile.email);
      const existing = (await listRememberedProfiles()).find((p) => p.userId === profile.id) ?? null;
      if (intent === false) {
        if (existing) await forgetRememberedProfile(existing);
        return;
      }
      if (intent === null && !existing) return;

      const current = existing?.device ?? null;
      let device = isDeviceUsable(current) ? current : null;
      if (!profile.has_privacy_pin) {
        if (device) await supabase.rpc('revoke_trusted_device', { p_id: device.id });
        device = null;
      } else if (intent === true || !device) {
        try {
          device = await registerThisDevice(existing?.device?.id ?? null);
        } catch (err) {
          console.error('[TrustedDevice] Rejestracja komputera nieudana', err instanceof Error ? err.name : 'unknown');
        }
      }

      await putProfile({
        userId: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        avatarSrc: profile.avatar_url ? `${profile.avatar_url}?v=${profile.updated_at}` : null,
        lastUsedAt: Date.now(),
        device,
      });
    })
    .catch((err) => {
      console.error('[TrustedDevice] Zapis profilu nieudany', err instanceof Error ? err.name : 'unknown');
    });
  return syncQueue;
}

// Ustawienia powiadomień instancji (app_settings.notifications_settings), klucz Resend
// (sekret resend_api_key w Vault, odczyt service_get_secrets) i konfiguracja serwera
// (notification_server_config: adres i token wywołania wysyłki z pg_net, publiczny klucz VAPID;
// prywatny klucz VAPID w Vault). Tylko service_role.
//
// Adres wysyłki (cel net.http_post z bazy, z tokenem w nagłówku) pochodzi wyłącznie z konfiguracji
// operatora: NOTIFICATIONS_DISPATCH_URL albo kanoniczny adres instancji (configuredInstanceOrigin).
// Nigdy z app_settings (edytuje je administrator instancji) ani z nagłówków żądania.

import { randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { configuredInstanceOrigin } from '../issuer.js';
import { getServiceClient } from '../supabase.js';

export const SETTINGS_KEY = 'notifications_settings';
export const RESEND_KEY = 'resend_api_key';

export interface NotificationsSettings {
  email_enabled: boolean;
  push_enabled: boolean;
  from_email: string;
  from_name: string;
  reply_to: string;
  app_url: string;
  include_titles: boolean;
}

export const DEFAULT_SETTINGS: NotificationsSettings = {
  email_enabled: true,
  push_enabled: true,
  from_email: '',
  from_name: '',
  reply_to: '',
  app_url: '',
  include_titles: true,
};

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const LOCAL_HOST_RE = /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

export class SettingsValidationError extends Error {}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function validEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length <= 200 && EMAIL_RE.test(email) ? email : '';
}

function validAppUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return normalizeAppUrl(value);
  } catch {
    return '';
  }
}

/**
 * Odczyt odporny per pole: brakujące albo złe pole = wartość domyślna. Te same reguły co przy
 * zapisie (`mergeSettings`), bo wiersz app_settings Poseł/administrator może zmienić także poza
 * `op=admin_save` - zły adres portalu albo nadawcy nie może trafić do linków ani nagłówka From.
 */
export function parseSettings(raw: unknown): NotificationsSettings {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    email_enabled: bool(obj.email_enabled, DEFAULT_SETTINGS.email_enabled),
    push_enabled: bool(obj.push_enabled, DEFAULT_SETTINGS.push_enabled),
    from_email: validEmail(obj.from_email),
    from_name: cleanName(str(obj.from_name, '')).slice(0, 100),
    reply_to: validEmail(obj.reply_to),
    app_url: validAppUrl(obj.app_url),
    include_titles: bool(obj.include_titles, DEFAULT_SETTINGS.include_titles),
  };
}

/**
 * Kanoniczny adres instancji albo null (lokalnie bez OAUTH_ISSUER). Zła wartość env = null
 * z wpisem w logu - linki i wysyłka nie mogą wtedy wywrócić całego modułu.
 */
export function instanceOrigin(): string | null {
  try {
    return configuredInstanceOrigin();
  } catch (err) {
    console.error('[notifications] instance origin', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Ustawienia z bazy; `app_url` = adres instancji, gdy jest skonfigurowany (wartość z bazy tylko
 * lokalnie) - linki w e-mailach nie mogą prowadzić na host wpisany przez administratora.
 */
export async function loadSettings(): Promise<NotificationsSettings> {
  const { data, error } = await getServiceClient()
    .from('app_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();
  if (error) throw new Error(`app_settings: ${error.message}`);
  const settings = parseSettings(data?.value);
  return { ...settings, app_url: instanceOrigin() ?? settings.app_url };
}

export async function loadResendKey(): Promise<string> {
  const { data, error } = await getServiceClient().rpc('service_get_secrets', { p_keys: [RESEND_KEY] });
  if (error) throw new Error(`service_get_secrets: ${error.message}`);
  const row = ((data ?? []) as { key: string; value: string }[]).find((r) => r.key === RESEND_KEY);
  return row?.value.trim() ?? '';
}

/** Adres publiczny portalu: https (http tylko localhost), sam origin. */
export function normalizeAppUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SettingsValidationError('Adres portalu nie jest poprawnym adresem URL.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOST_RE.test(url.host))) {
    throw new SettingsValidationError('Adres portalu musi używać https.');
  }
  return url.origin;
}

function cleanName(value: string): string {
  // Nazwa trafia do nagłówka From - bez znaków, które psują składnię adresu.
  return value.replace(/[\r\n<>"]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Zmiana częściowa: pola spoza kontraktu odrzucane, reszta bez zmian. `fixedOrigin` (adres
 * instancji z konfiguracji) wyklucza inny adres portalu; bez niego pusty adres = `fallbackOrigin`.
 */
export function mergeSettings(
  current: NotificationsSettings,
  input: unknown,
  fixedOrigin: string | null,
  fallbackOrigin: string | null,
): NotificationsSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SettingsValidationError('Ustawienia muszą być obiektem.');
  }
  const patch = input as Record<string, unknown>;
  const next = { ...current };
  for (const [field, value] of Object.entries(patch)) {
    if (!(field in DEFAULT_SETTINGS)) throw new SettingsValidationError(`Nieznane pole: ${field}.`);
    const expected = typeof DEFAULT_SETTINGS[field as keyof NotificationsSettings];
    if (typeof value !== expected) throw new SettingsValidationError(`Pole ${field} ma zły typ.`);
  }
  if (typeof patch.email_enabled === 'boolean') next.email_enabled = patch.email_enabled;
  if (typeof patch.push_enabled === 'boolean') next.push_enabled = patch.push_enabled;
  if (typeof patch.include_titles === 'boolean') next.include_titles = patch.include_titles;
  if (typeof patch.from_email === 'string') {
    const value = patch.from_email.trim().toLowerCase();
    if (value && (value.length > 200 || !EMAIL_RE.test(value))) {
      throw new SettingsValidationError('Adres nadawcy nie jest poprawnym adresem e-mail.');
    }
    next.from_email = value;
  }
  if (typeof patch.reply_to === 'string') {
    const value = patch.reply_to.trim().toLowerCase();
    if (value && (value.length > 200 || !EMAIL_RE.test(value))) {
      throw new SettingsValidationError('Adres do odpowiedzi nie jest poprawnym adresem e-mail.');
    }
    next.reply_to = value;
  }
  if (typeof patch.from_name === 'string') {
    const value = cleanName(patch.from_name);
    if (value.length > 100) throw new SettingsValidationError('Nazwa nadawcy może mieć najwyżej 100 znaków.');
    next.from_name = value;
  }
  if (typeof patch.app_url === 'string') {
    next.app_url = patch.app_url.trim() ? normalizeAppUrl(patch.app_url) : '';
  }
  if (fixedOrigin) {
    if (next.app_url && next.app_url !== fixedOrigin) {
      throw new SettingsValidationError(`Adres portalu wynika z konfiguracji instancji: ${fixedOrigin}.`);
    }
    next.app_url = fixedOrigin;
  } else if (!next.app_url && fallbackOrigin) {
    next.app_url = normalizeAppUrl(fallbackOrigin);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Konfiguracja serwera
// ---------------------------------------------------------------------------

interface ServerConfigRow {
  dispatch_url: string | null;
  dispatch_token: string | null;
  vapid_public_key: string | null;
}

export async function loadServerConfig(): Promise<ServerConfigRow | null> {
  const { data, error } = await getServiceClient()
    .from('notification_server_config')
    .select('dispatch_url, dispatch_token, vapid_public_key')
    .eq('id', true)
    .maybeSingle();
  if (error) throw new Error(`notification_server_config: ${error.message}`);
  return (data as ServerConfigRow | null) ?? null;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/**
 * Klucze VAPID instancji: generowane przy pierwszym użyciu, potem stałe (zmiana = ponowna subskrypcja
 * urządzeń). Publiczny w notification_server_config, prywatny w Vault; zapis przez
 * service_store_vapid_keys - równoległe wywołanie, które zapisało klucze pierwsze, wygrywa.
 */
export async function ensureVapidKeys(): Promise<VapidKeys> {
  const supabase = getServiceClient();
  const [existing, secretsRes] = await Promise.all([
    loadServerConfig(),
    supabase.rpc('service_get_secrets', { p_keys: ['vapid_private_key'] }),
  ]);
  if (secretsRes.error) throw new Error(`service_get_secrets: ${secretsRes.error.message}`);
  const privateKey = ((secretsRes.data ?? []) as { key: string; value: string }[]).find(
    (r) => r.key === 'vapid_private_key',
  )?.value;
  if (existing?.vapid_public_key && privateKey) {
    return { publicKey: existing.vapid_public_key, privateKey };
  }
  const generated = webpush.generateVAPIDKeys();
  const { data, error } = await supabase
    .rpc('service_store_vapid_keys', { p_public_key: generated.publicKey, p_private_key: generated.privateKey })
    .maybeSingle();
  if (error) throw new Error(`service_store_vapid_keys: ${error.message}`);
  const saved = data as { public_key: string | null; private_key: string | null } | null;
  if (!saved?.public_key || !saved.private_key) throw new Error('Nie udało się zapisać kluczy VAPID');
  return { publicKey: saved.public_key, privateKey: saved.private_key };
}

const DISPATCH_PATH = '/api/notifications?op=dispatch';
// Ten sam kształt wymusza CHECK notification_server_config_dispatch_url_safe w bazie:
// https bez portu albo http://host.docker.internal:port (lokalny test: baza w Dockerze → host).
const DISPATCH_URL_RE =
  /^(?:https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|http:\/\/host\.docker\.internal:\d{1,5})\/api\/notifications\?op=dispatch$/;

/** Adres wysyłki z konfiguracji operatora albo null (brak rejestracji = kolejkę opróżnia cron). */
export function resolveDispatchUrl(): string | null {
  const override = process.env.NOTIFICATIONS_DISPATCH_URL?.trim();
  const origin = override ? null : instanceOrigin();
  const url = override || (origin ? `${origin}${DISPATCH_PATH}` : null);
  if (!url) return null;
  if (!DISPATCH_URL_RE.test(url)) {
    console.error('[notifications] dispatch url rejected (NOTIFICATIONS_DISPATCH_URL / adres instancji)');
    return null;
  }
  return url;
}

/**
 * Rejestruje adres, pod który pg_net zgłasza nowe powiadomienia (op=dispatch). Zmiana adresu =
 * nowy token (stary przestaje działać; to samo wymusza trigger w bazie). Bez adresu z konfiguracji
 * istniejąca rejestracja zostaje bez zmian (np. lokalny serwer podłączony do innej bazy).
 * Zwraca, czy wysyłka jest zarejestrowana.
 */
export async function syncDispatchRegistration(): Promise<boolean> {
  const dispatchUrl = resolveDispatchUrl();
  const existing = await loadServerConfig();
  if (!dispatchUrl) return Boolean(existing?.dispatch_url && existing.dispatch_token);
  if (existing?.dispatch_url === dispatchUrl && existing.dispatch_token) return true;
  const { error } = await getServiceClient()
    .from('notification_server_config')
    .upsert({
      id: true,
      dispatch_url: dispatchUrl,
      dispatch_token: randomBytes(32).toString('base64url'),
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(`notification_server_config: ${error.message}`);
  return true;
}

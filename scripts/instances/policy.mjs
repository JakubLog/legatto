// Oczekiwana konfiguracja instancji (jedna instancja = jeden poseł, ADR 026), wspólna dla
// scripts/instances/provision.mjs (ustawia) i scripts/instances/doctor.mjs (sprawdza).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MANAGEMENT_API = 'https://api.supabase.com';

// "lower_upper_letters_digits_symbols" (supabase/config.toml) w zapisie Management API.
export const PASSWORD_REQUIRED_CHARACTERS =
  "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\\\:\"|<>?,./`~";

export const INVITE_SUBJECT = 'Zaproszenie do systemu biura poselskiego';

/** Ustawienia Auth dostępne na każdym planie. `origin` = https://<domena instancji>. */
export function authConfig(origin) {
  return {
    site_url: origin,
    uri_allow_list: `${origin}/login`,
    // ADR 002: konta zakłada Poseł (admin-create-user); nowy projekt ma rejestrację włączoną.
    disable_signup: true,
    external_email_enabled: true,
    external_phone_enabled: false,
    external_anonymous_users_enabled: false,
    mailer_autoconfirm: false,
    mailer_secure_email_change_enabled: true,
    jwt_exp: 3600,
    password_min_length: 12,
    password_required_characters: PASSWORD_REQUIRED_CHARACTERS,
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
    refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10,
    security_update_password_require_reauthentication: true,
    security_update_password_require_current_password: true,
    mailer_subjects_invite: INVITE_SUBJECT,
    mailer_templates_invite_content: fs.readFileSync(path.join(REPO_ROOT, 'supabase/templates/invite.html'), 'utf8'),
  };
}

/** Ustawienia Auth wymagające planu Pro (na Free Management API zwraca 402). */
export const PRO_AUTH_CONFIG = {
  password_hibp_enabled: true,
  sessions_timebox: 30 * 24 * 3600, // sesja najwyżej 30 dni
  sessions_inactivity_timeout: 7 * 24 * 3600, // wylogowanie po 7 dniach bez odświeżenia tokenu
};

/** Sekrety Edge Functions wymagane na każdej instancji (`.env.example`, sekcja Edge Functions). */
export const REQUIRED_EDGE_SECRETS = ['ALLOWED_ORIGINS', 'AUTH_REDIRECT_URL', 'TURNSTILE_SECRET', 'PUBLIC_SUBMISSION_IP_SALT'];

/** Jedyne tabele czytelne dla `anon` (słowniki strony publicznej). */
export const ANON_READABLE_TABLES = ['offices', 'powiaty', 'gminy', 'case_categories'];

/** Jedyne funkcje RPC wykonywalne dla `anon`. */
export const ANON_RPC_PREFIX = 'get_public_';

export function parseRef(value) {
  if (!/^[a-z]{20}$/.test(value ?? '')) throw new Error(`Niepoprawny ref projektu Supabase: ${value ?? '(brak)'}`);
  return value;
}

export function parseDomain(value) {
  const domain = (value ?? '').trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
    throw new Error(`Niepoprawna domena instancji (sama nazwa hosta, bez https://): ${value ?? '(brak)'}`);
  }
  return domain;
}

export function edgeFunctionSlugs() {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'supabase/functions'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();
}

export function migrationVersions() {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'supabase/migrations'))
    .map((name) => /^(\d{14})_.+\.sql$/.exec(name)?.[1])
    .filter(Boolean)
    .sort();
}

/** Token Management API: zwykły `sbp_...` albo zapis pęku kluczy CLI (`go-keyring-base64:`). */
export function managementToken() {
  const raw = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!raw) return null;
  return raw.startsWith('go-keyring-base64:') ? Buffer.from(raw.slice(18), 'base64').toString('utf8').trim() : raw;
}

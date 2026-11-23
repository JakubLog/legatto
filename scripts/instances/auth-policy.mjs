#!/usr/bin/env node
// Polityka Auth VPS biura jako dane: supabase/selfhost/auth-policy.json (legatto-auth-policy/1).
// Źródłem prawdy jest scripts/instances/policy.mjs (authConfig + PRO_AUTH_CONFIG, Supabase Cloud);
// ten moduł tłumaczy je na zmienne GoTrue. legatto-infra (PlatformTrack) porównuje plik z
// `environment` usługi auth po `docker compose config`.
//
//   node scripts/instances/auth-policy.mjs --check   plik zgodny z policy.mjs (CI), kod 1 przy różnicy
//   node scripts/instances/auth-policy.mjs --write   wygeneruj plik ponownie
//
// Format:
//   env          GOTRUE_* → wartość tekstowa (jak w env kontenera; czasy jako Go duration, np. 720h)
//   origin_env   wartości z adresem instancji: {origin} = https://app.<domena>,
//                {admin_origin} = https://admin.app.<domena> (panel admina na VPS, A5)
//   feature_env  wartość zależna od opcji biura (features.json w legatto-infra): {feature, default}
//   not_env      klucze policy.mjs bez zmiennej GoTrue na VPS, z powodem
// Każdy klucz authConfig/PRO_AUTH_CONFIG musi mieć przypisanie poniżej - nowy klucz w policy.mjs
// bez przypisania przerywa --check.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRO_AUTH_CONFIG, REPO_ROOT, authConfig } from './policy.mjs';

export const POLICY_FILE = path.join(REPO_ROOT, 'supabase', 'selfhost', 'auth-policy.json');
const ORIGIN = '{origin}';

/** Klucz Management API → zmienna GoTrue. */
const ENV_NAMES = {
  disable_signup: 'GOTRUE_DISABLE_SIGNUP',
  external_email_enabled: 'GOTRUE_EXTERNAL_EMAIL_ENABLED',
  external_phone_enabled: 'GOTRUE_EXTERNAL_PHONE_ENABLED',
  external_anonymous_users_enabled: 'GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED',
  mailer_autoconfirm: 'GOTRUE_MAILER_AUTOCONFIRM',
  mailer_secure_email_change_enabled: 'GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED',
  jwt_exp: 'GOTRUE_JWT_EXP',
  password_min_length: 'GOTRUE_PASSWORD_MIN_LENGTH',
  password_required_characters: 'GOTRUE_PASSWORD_REQUIRED_CHARACTERS',
  mfa_totp_enroll_enabled: 'GOTRUE_MFA_TOTP_ENROLL_ENABLED',
  mfa_totp_verify_enabled: 'GOTRUE_MFA_TOTP_VERIFY_ENABLED',
  refresh_token_rotation_enabled: 'GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED',
  security_refresh_token_reuse_interval: 'GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL',
  security_update_password_require_reauthentication: 'GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION',
  security_update_password_require_current_password: 'GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD',
  mailer_subjects_invite: 'GOTRUE_MAILER_SUBJECTS_INVITE',
  // Sekundy w Management API, Go duration w GoTrue.
  sessions_timebox: 'GOTRUE_SESSIONS_TIMEBOX',
  sessions_inactivity_timeout: 'GOTRUE_SESSIONS_INACTIVITY_TIMEOUT',
};
const DURATION_KEYS = { sessions_timebox: true, sessions_inactivity_timeout: true };

const ORIGIN_NAMES = {
  site_url: 'GOTRUE_SITE_URL',
  uri_allow_list: 'GOTRUE_URI_ALLOW_LIST',
};
/** Dodatkowe adresy przekierowań VPS (SPA loguje się też na hoście panelu admina). */
const SELFHOST_REDIRECTS = { uri_allow_list: ['{admin_origin}/login'] };

const FEATURE_NAMES = {
  password_hibp_enabled: { env: 'GOTRUE_PASSWORD_HIBP_ENABLED', feature: 'hibp' },
};

const NOT_ENV = {
  mailer_templates_invite_content:
    'VPS nie używa szablonów GoTrue: maile Auth wysyła Send Email Hook aplikacji (server/auth-email-hook.ts) z supabase/templates/invite.html',
};

/** Stałe VPS bez odpowiednika w policy.mjs (Supabase Cloud ich nie ma albo ustawia sam). */
const SELFHOST_ENV = {
  GOTRUE_HOOK_SEND_EMAIL_ENABLED: 'true',
};

function envValue(key, value) {
  if (DURATION_KEYS[key]) {
    if (!Number.isInteger(value) || value % 3600 !== 0) throw new Error(`${key}: ${value} s nie jest pełną liczbą godzin`);
    return `${value / 3600}h`;
  }
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  throw new Error(`${key}: nieobsługiwany typ ${typeof value}`);
}

/** Polityka VPS wyliczona z policy.mjs. Rzuca, gdy klucz policy.mjs nie ma przypisania. */
export function selfhostAuthPolicy() {
  const source = { ...authConfig(ORIGIN), ...PRO_AUTH_CONFIG };
  const policy = { schema: 'legatto-auth-policy/1', env: { ...SELFHOST_ENV }, origin_env: {}, feature_env: {}, not_env: {} };
  const unmapped = [];
  for (const [key, value] of Object.entries(source)) {
    if (ENV_NAMES[key]) policy.env[ENV_NAMES[key]] = envValue(key, value);
    else if (ORIGIN_NAMES[key]) policy.origin_env[ORIGIN_NAMES[key]] = [value, ...(SELFHOST_REDIRECTS[key] ?? [])].join(',');
    else if (FEATURE_NAMES[key]) {
      policy.feature_env[FEATURE_NAMES[key].env] = { feature: FEATURE_NAMES[key].feature, default: envValue(key, value) };
    } else if (NOT_ENV[key]) policy.not_env[key] = NOT_ENV[key];
    else unmapped.push(key);
  }
  if (unmapped.length) throw new Error(`klucze policy.mjs bez przypisania w auth-policy.mjs: ${unmapped.join(', ')}`);
  return policy;
}

/** Kanoniczny zapis (klucze posortowane, wcięcie 2, nowa linia na końcu). */
export function serializePolicy(policy) {
  const sort = (value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, sort(value[k])]))
      : value;
  return `${JSON.stringify(sort(policy), null, 2)}\n`;
}

function main(argv) {
  const mode = argv[0];
  if (argv.length !== 1 || (mode !== '--check' && mode !== '--write')) {
    console.error('użycie: auth-policy.mjs --check | --write');
    return 2;
  }
  const expected = serializePolicy(selfhostAuthPolicy());
  if (mode === '--write') {
    fs.mkdirSync(path.dirname(POLICY_FILE), { recursive: true });
    fs.writeFileSync(POLICY_FILE, expected);
    console.log(`auth-policy: zapisano ${path.relative(REPO_ROOT, POLICY_FILE)}`);
    return 0;
  }
  const actual = fs.existsSync(POLICY_FILE) ? fs.readFileSync(POLICY_FILE, 'utf8') : '';
  if (actual !== expected) {
    console.error(
      `auth-policy: ${path.relative(REPO_ROOT, POLICY_FILE)} niezgodny z scripts/instances/policy.mjs - ` +
        'uruchom `node scripts/instances/auth-policy.mjs --write` i zgłoś zmianę w legatto-infra (bundle/env/auth.env.tmpl)',
    );
    return 1;
  }
  console.log('auth-policy: OK (supabase/selfhost/auth-policy.json zgodny z policy.mjs)');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

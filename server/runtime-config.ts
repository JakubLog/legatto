// Konfiguracja runtime SPA (`/runtime-config.js` → window.__LEGATTO__). Jedna paczka wydania działa
// w każdym biurze: adres Supabase, klucze publiczne, tytuł i flagi pochodzą z env kontenera app,
// nie z builda. Na Vercelu ten sam plik powstaje statycznie przy buildzie (vite.config.ts) ze
// zmiennych VITE_* - SPA ma jedną ścieżkę odczytu w obu trybach.
//
// Bez zależności: importuje go vite.config.ts i server/.

import { deploymentTarget, icsAllowedHosts, instanceFlags } from '../api/_lib/instance.js';
import type { RuntimeConfig, Surface } from '../src/lib/runtime-config-types.js';

type Env = Record<string, string | undefined>;

export const DEFAULT_APP_TITLE = 'Biuro Poselskie';

const LOCAL_HOST_RE = /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

/** Origin https (http tylko localhost) albo błąd z nazwą zmiennej. */
export function parsePublicOrigin(raw: string, name: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} nie jest poprawnym adresem URL`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOST_RE.test(url.host))) {
    throw new Error(`${name} musi używać https (http tylko dla localhost)`);
  }
  return url.origin;
}

function trimmed(env: Env, name: string): string {
  return env[name]?.trim() ?? '';
}

/** Tytuł aplikacji instancji (index.html, manifest PWA, SPA). */
export function appTitle(env: Env): string {
  const name = deploymentTarget(env) === 'selfhost' ? 'APP_TITLE' : 'VITE_APP_TITLE';
  return trimmed(env, name) || DEFAULT_APP_TITLE;
}

export interface RuntimeConfigRequest {
  version: string;
  /**
   * Origin strony, z której SPA pobrało konfigurację (tylko VPS: gateway Supabase jest pod tym
   * samym originem, więc crm i admin mają własne adresy bez osobnej konfiguracji).
   */
  origin?: string;
  surface?: Surface | null;
}

/**
 * Konfiguracja dla przeglądarki. VPS (LEGATTO_TARGET=selfhost): supabaseUrl = PUBLIC_SUPABASE_URL albo
 * origin żądania, klucze i tytuł z env kontenera (SUPABASE_ANON_KEY, TURNSTILE_KEY, SUPPORT_EMAIL,
 * APP_TITLE, ADMIN_ORIGIN). Vercel: zmienne VITE_* builda, bez powierzchni i hosta admina.
 */
export function buildRuntimeConfig(env: Env, request: RuntimeConfigRequest): RuntimeConfig {
  const selfhost = deploymentTarget(env) === 'selfhost';
  const explicitUrl = trimmed(env, selfhost ? 'PUBLIC_SUPABASE_URL' : 'VITE_SUPABASE_URL');
  const supabaseUrl = explicitUrl
    ? parsePublicOrigin(explicitUrl, selfhost ? 'PUBLIC_SUPABASE_URL' : 'VITE_SUPABASE_URL')
    : selfhost
      ? (request.origin ?? '')
      : '';
  const adminRaw = selfhost ? trimmed(env, 'ADMIN_ORIGIN') : '';
  return {
    version: request.version,
    supabaseUrl,
    supabaseAnonKey: trimmed(env, selfhost ? 'SUPABASE_ANON_KEY' : 'VITE_SUPABASE_ANON_KEY'),
    turnstileKey: trimmed(env, 'TURNSTILE_KEY'),
    supportEmail: trimmed(env, selfhost ? 'SUPPORT_EMAIL' : 'VITE_SUPPORT_EMAIL'),
    appTitle: appTitle(env),
    instance: instanceFlags(env),
    icsAllowedHosts: icsAllowedHosts(env),
    surface: selfhost ? (request.surface ?? null) : null,
    adminOrigin: adminRaw ? parsePublicOrigin(adminRaw, 'ADMIN_ORIGIN') : null,
  };
}

/** Treść `/runtime-config.js`: zamrożony obiekt, JSON bezpieczny także wewnątrz <script>. */
export function renderRuntimeConfigScript(config: RuntimeConfig): string {
  const json = JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `window.__LEGATTO__=Object.freeze(${json});\n`;
}

/** Tytuł do wstawienia w HTML (index.html: <title>, og:title). */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Placeholder tytułu w index.html i manifeście PWA builda self-host; podstawia go serwer. */
export const APP_TITLE_PLACEHOLDER = '%APP_TITLE%';

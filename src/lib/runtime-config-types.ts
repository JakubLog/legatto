// Kształt konfiguracji runtime (window.__LEGATTO__ z /runtime-config.js). Tylko typy: plik
// importują SPA (src/lib/runtime-config.ts), serwer (server/runtime-config.ts) i api/_lib/instance.ts,
// każdy z innym zestawem bibliotek TypeScript.

/** Dodatki instancji włączane przez operatora / admina biura (api/_lib/instance.ts). */
export interface InstanceFlags {
  ai: boolean;
  mcp: boolean;
  email: boolean;
  push: boolean;
  getresponse: boolean;
  ics: boolean;
}

/** Powierzchnia, z której przyszło żądanie (nagłówek X-Legatto-Surface z proxy biura); null na Vercelu. */
export type Surface = 'crm' | 'admin';

export interface RuntimeConfig {
  /** Wersja wydania aplikacji (semver). */
  version: string;
  /** Adres Supabase dla przeglądarki; na VPS = origin strony (gateway pod tym samym originem). */
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Publiczny site key Cloudflare Turnstile; '' = formularz niedostępny. */
  turnstileKey: string;
  /** Kontakt w sprawie resetu 2FA; '' = brak. */
  supportEmail: string;
  appTitle: string;
  instance: InstanceFlags;
  /** Hosty kalendarzy ICS dozwolone na instancji; null = bez ograniczenia. */
  icsAllowedHosts: string[] | null;
  surface: Surface | null;
  /** Origin panelu administracyjnego (https://admin.app.<domena>); null = brak osobnego hosta. */
  adminOrigin: string | null;
}

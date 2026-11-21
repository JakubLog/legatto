/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly TURNSTILE_KEY?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Flagi instancji z vite.config.ts (define). Używaj przez `INSTANCE` z `@/lib/instance`. */
declare const __INSTANCE__: { ai: boolean; email: boolean };

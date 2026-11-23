// Konfiguracja instancji w przeglądarce: window.__LEGATTO__ z /runtime-config.js (skrypt w index.html
// przed bundlem). Na VPS plik generuje serwer z env kontenera (jedna paczka dla wszystkich biur), na
// Vercelu powstaje przy buildzie ze zmiennych VITE_* (vite.config.ts). Brak pliku (np. offline bez
// cache) = pusta konfiguracja: aplikacja pokazuje ekran braku konfiguracji, dodatki wyłączone.

import type { RuntimeConfig } from './runtime-config-types';

export type { RuntimeConfig, InstanceFlags, Surface } from './runtime-config-types';

declare global {
  interface Window {
    __LEGATTO__?: RuntimeConfig;
  }
}

const EMPTY: RuntimeConfig = {
  version: '',
  supabaseUrl: '',
  supabaseAnonKey: '',
  turnstileKey: '',
  supportEmail: '',
  appTitle: '',
  instance: { ai: false, mcp: false, email: false, push: false, getresponse: false, ics: false },
  icsAllowedHosts: [],
  surface: null,
  adminOrigin: null,
};

export const RUNTIME_CONFIG: Readonly<RuntimeConfig> =
  typeof window !== 'undefined' && window.__LEGATTO__ ? window.__LEGATTO__ : EMPTY;

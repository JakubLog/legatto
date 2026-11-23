import { createClient } from '@supabase/supabase-js';
import { RUNTIME_CONFIG } from '@/lib/runtime-config';

// Adres i klucz anon z konfiguracji runtime (/runtime-config.js): na VPS gateway Supabase jest pod
// originem strony, na Vercelu adres projektu Supabase z builda (VITE_SUPABASE_URL).
const supabaseUrl = RUNTIME_CONFIG.supabaseUrl;
const supabaseAnonKey = RUNTIME_CONFIG.supabaseAnonKey;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // Diagnostyka w konsoli - nie rzucamy żeby aplikacja mogła pokazać ekran konfiguracji
  console.warn(
    '[Supabase] Brak konfiguracji w /runtime-config.js. Lokalnie ustaw VITE_SUPABASE_URL i VITE_SUPABASE_ANON_KEY w .env.local',
  );
}

// Tworzymy klienta z placeholderami jeśli brak konfiguracji - nie crashujemy.
// Wszystkie wywołania zakończą się błędem sieci, co jest oczekiwane przy braku configu.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
  },
);

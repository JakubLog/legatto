import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // Diagnostyka w konsoli - nie rzucamy żeby aplikacja mogła pokazać ekran konfiguracji
  console.warn(
    '[Supabase] Brak konfiguracji. Ustaw VITE_SUPABASE_URL i VITE_SUPABASE_ANON_KEY w .env.local',
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

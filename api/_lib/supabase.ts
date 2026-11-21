import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

// Brak zmiennej = blad od razu (bez cichego '' przekazanego do createClient).
function requiredEnv(primary: string, fallback: string): string {
  const value = process.env[primary]?.trim() || process.env[fallback]?.trim();
  if (!value) throw new Error(`Brak konfiguracji Supabase: wymagane ${primary} (albo ${fallback}) w env.`);
  return value;
}

export function getServiceClient(): SupabaseClient {
  if (cached) return cached;

  const url = requiredEnv('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) throw new Error('Brak konfiguracji Supabase: wymagane SUPABASE_SERVICE_ROLE_KEY w env.');

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'office-mcp/1.0' } },
  });
  return cached;
}

/**
 * Klient z kluczem anon: bez tokenu do `auth.getUser(token)`, z tokenem - zapytania jako ten
 * uzytkownik (RLS). Brak SUPABASE_URL / SUPABASE_ANON_KEY (lub VITE_*) = blad.
 */
export function getAnonClient(accessToken?: string): SupabaseClient {
  return createClient(requiredEnv('SUPABASE_URL', 'VITE_SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
  });
}

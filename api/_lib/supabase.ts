import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Brak konfiguracji Supabase: wymagane SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY w env.',
    );
  }

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'office-mcp/1.0' } },
  });
  return cached;
}

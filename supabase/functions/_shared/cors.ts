// CORS — whitelist origin zamiast wildcard.
// Jedna instancja = jeden poseł: originy produkcyjne tej instancji podaje sekret
// ALLOWED_ORIGINS (lista po przecinku, np. "https://biuro.example.pl").
// Localhost dla dev jest dozwolony tylko, gdy sekret nie jest ustawiony (lokalne `supabase functions serve`);
// ustawiony sekret = wyłącznie wymienione originy.
const DEV_ORIGINS = [
  'http://localhost:8080',
  'http://localhost:3000',
];

function parseOrigins(raw: string | undefined): string[] {
  const origins: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const value = part.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
      origins.push(url.origin);
    } catch {
      console.error(`[cors] Pomijam niepoprawny origin w ALLOWED_ORIGINS: ${value}`);
    }
  }
  return origins;
}

const RAW_ALLOWED_ORIGINS = Deno.env.get('ALLOWED_ORIGINS')?.trim() ?? '';

/** Brak sekretu ALLOWED_ORIGINS = lokalne dev: dozwolony localhost. */
export const IS_LOCAL_DEV = RAW_ALLOWED_ORIGINS === '';

/** Originy produkcyjne z sekretu ALLOWED_ORIGINS (bez localhost). */
export const INSTANCE_ORIGINS: readonly string[] = parseOrigins(RAW_ALLOWED_ORIGINS);

const ALLOWED_ORIGINS: readonly string[] = IS_LOCAL_DEV ? DEV_ORIGINS : INSTANCE_ORIGINS;
if (!IS_LOCAL_DEV && ALLOWED_ORIGINS.length === 0) {
  console.error('[cors] ALLOWED_ORIGINS ustawiony, ale bez poprawnych originow - CORS zablokuje przegladarke');
}

const STATIC_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin',
};

export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': allowed } : {}),
    ...STATIC_HEADERS,
  };
}

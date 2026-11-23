// Powierzchnia admin (Legatto self-host, A5).
//
// Na VPS proxy (Caddy) ustawia nagłówek X-Legatto-Surface wartością swojego listenera
// (nadpisując wartość klienta): `crm` dla app.<domena>, `admin` dla admin.app.<domena>.
// Funkcje admin-* (zarządzanie kontami, eksport danych) działają tylko na powierzchni admin.
// Kontrakt jak public.require_admin_surface() w bazie (migracja 20261121200000_admin_surface.sql):
//   - nagłówek `admin`                                   -> dozwolone,
//   - inny nagłówek (np. `crm`)                          -> odmowa,
//   - brak nagłówka i LEGATTO_SURFACE_ENFORCE != "1"     -> dozwolone (Vercel / Supabase Cloud),
//   - brak nagłówka i LEGATTO_SURFACE_ENFORCE == "1"     -> odmowa (żądanie ominęło proxy VPS).

export const SURFACE_HEADER = 'x-legatto-surface';

const ENFORCE = Deno.env.get('LEGATTO_SURFACE_ENFORCE')?.trim() === '1';

/** true, gdy żądanie przyszło przez host admin (albo wymuszanie jest wyłączone i brak nagłówka). */
export function isAdminSurface(req: Request): boolean {
  const surface = req.headers.get(SURFACE_HEADER)?.trim().toLowerCase() ?? '';
  if (surface === 'admin') return true;
  return surface === '' && !ENFORCE;
}

/**
 * Odpowiedź 404 dla żądań spoza powierzchni admin (jak blokada ścieżek na proxy crm - funkcja
 * nie ujawnia, że istnieje), albo null, gdy można kontynuować.
 */
export function adminSurfaceGuard(req: Request, cors: Record<string, string>): Response | null {
  if (isAdminSurface(req)) return null;
  return new Response(JSON.stringify({ error: 'Dostępne tylko w panelu administracyjnym (admin.app)' }), {
    status: 404,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

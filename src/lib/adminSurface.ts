// Powierzchnia admin (A5, migracja 20261121200000_admin_surface.sql).
//
// Na VPS ta sama SPA działa pod dwoma hostami w tailnecie: CRM (app.<domena>, surface 'crm') i panel
// administracyjny (admin.app.<domena>, surface 'admin', tylko urządzenia biura). Funkcje wrażliwe
// (eksport danych, tworzenie/usuwanie kont, reset 2FA, wylogowanie, linki logowania) backend
// odrzuca na CRM (proxy blokuje admin-*, require_admin_surface() rzuca 42501) - UI na CRM pokazuje
// zamiast nich odnośnik do panelu. Na Vercelu surface = null: wszystko jak dotąd.

import { RUNTIME_CONFIG, type RuntimeConfig } from '@/lib/runtime-config';

type SurfaceConfig = Pick<RuntimeConfig, 'surface' | 'adminOrigin'>;

/** Czy funkcje wrażliwe są tu niedostępne (CRM na VPS) i trzeba przejść do panelu administracyjnego. */
export function isAdminSurfaceRequired(config: SurfaceConfig = RUNTIME_CONFIG): boolean {
  return config.surface === 'crm';
}

/** Adres tej samej ścieżki w panelu administracyjnym; null, gdy instancja nie ma osobnego hosta. */
export function adminUrl(path: string, config: SurfaceConfig = RUNTIME_CONFIG): string | null {
  if (!config.adminOrigin) return null;
  const origin = config.adminOrigin.replace(/\/+$/, '');
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

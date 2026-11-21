import {
  Activity,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  ClipboardList,
  FileText,
  History,
  Home,
  LayoutTemplate,
  MapPinned,
  Plug,
  Settings,
  Signature,
  Sparkles,
  Trash2,
  User as UserIcon,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { AppRole } from '@/integrations/supabase/types';
import { INSTANCE } from '@/lib/instance';
import { isAdmin } from '@/lib/permissions';

export interface NavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
  end?: boolean;
  /** Dodatkowe słowa kluczowe dla wyszukiwarki (bez polskich znaków nie trzeba - normalizujemy). */
  keywords?: string[];
  /** Konfiguracja tylko na komputer: ukryta w menu na telefonie (trasa w `DesktopOnlyRoute`). */
  desktopOnly?: boolean;
}

export interface NavSection {
  id: 'main' | 'tools' | 'admin';
  label: string | null;
  items: NavItem[];
}

export const MAIN_NAV_ITEMS: NavItem[] = [
  { to: '/biuro', label: 'Pulpit', Icon: Home, end: true, keywords: ['dashboard', 'start'] },
  { to: '/biuro/sprawy', label: 'Sprawy wyborców', Icon: Briefcase, keywords: ['zgłoszenia'] },
  { to: '/biuro/kontakty', label: 'Centrum Kontaktowe', Icon: Users, keywords: ['kontakty', 'newsletter'] },
  { to: '/biuro/kalendarz', label: 'Kalendarz', Icon: Calendar, keywords: ['wydarzenia', 'spotkania'] },
  { to: '/biuro/teren', label: 'Widoczność w terenie', Icon: MapPinned, keywords: ['mapa', 'powiaty'] },
  { to: '/biuro/interpelacje', label: 'Interpelacje', Icon: FileText },
  {
    to: '/biuro/dokumenty',
    label: 'Dokumenty do podpisu',
    Icon: Signature,
    keywords: ['podpis', 'paczka'],
  },
  { to: '/biuro/budzet', label: 'Budżet biura', Icon: Wallet, keywords: ['wydatki', 'faktury'] },
];

/** Integracje: dla każdej roli; kafelki na stronie zależą od roli i konfiguracji instancji. */
export const INTEGRATIONS_NAV_ITEM: NavItem = {
  to: '/biuro/admin/integracje',
  label: 'Integracje',
  Icon: Plug,
  // Słowa AI/MCP tylko z włączonym AI - inaczej wyszukiwarka prowadziłaby do nieistniejących kafelków.
  keywords: INSTANCE.ai ? ['mcp', 'claude', 'getresponse', 'ics', 'ai'] : ['getresponse', 'ics'],
};

/** Kosz: dla każdej roli (Poseł/administrator widzą wszystkie pozycje, pozostali swoje usunięcia). */
export const TRASH_NAV_ITEM: NavItem = {
  to: '/biuro/kosz',
  label: 'Kosz',
  Icon: Trash2,
  keywords: ['usunięte', 'przywróć', 'przywracanie'],
};

// Widoczne tylko dla Posła (admin panel).
export const ADMIN_NAV_ITEMS: NavItem[] = [
  { to: '/biuro/puls', label: 'Puls Biura', Icon: Activity, keywords: ['sygnały', 'stan biura', 'zaniedbania'] },
  { to: '/biuro/admin/użytkownicy', label: 'Użytkownicy', Icon: Settings, keywords: ['konta', 'role'] },
  { to: '/biuro/admin/biura', label: 'Biura', Icon: Building2 },
  {
    to: '/biuro/admin/strona-główna',
    label: 'Strona główna',
    Icon: LayoutTemplate,
    keywords: ['strona publiczna', 'witryna', 'hero', 'seo', 'zdjęcie posła'],
  },
  {
    to: '/biuro/admin/obowiązki',
    label: 'Podział obowiązków',
    Icon: ClipboardList,
    keywords: ['obowiązki', 'odpowiedzialni', 'opiekun'],
    desktopOnly: true,
  },
  { to: '/biuro/admin/audit', label: 'Dziennik zmian', Icon: History, keywords: ['audit', 'historia'], desktopOnly: true },
  INTEGRATIONS_NAV_ITEM,
  TRASH_NAV_ITEM,
];

/** Wszystkie pozycje nawigacji (tytuły tras i ikony linków niezależnie od widoczności w menu). */
export const ALL_NAV_ITEMS: NavItem[] = [...MAIN_NAV_ITEMS, ...ADMIN_NAV_ITEMS];

export const PROFILE_NAV_ITEM: NavItem = {
  to: '/biuro/profil',
  label: 'Mój profil',
  Icon: UserIcon,
  keywords: ['konto', 'hasło', 'mfa', 'avatar', 'powiadomienia', 'e-mail', 'push'],
};

/** Sekcje nawigacji widoczne dla danej roli (te same warunki co trasy z RoleGuard). */
export function getNavSections(role: AppRole | null | undefined): NavSection[] {
  const sections: NavSection[] = [{ id: 'main', label: null, items: MAIN_NAV_ITEMS }];
  if (isAdmin(role)) {
    sections.push({ id: 'admin', label: 'Administracja', items: ADMIN_NAV_ITEMS });
  } else if (role) {
    sections.push({ id: 'tools', label: 'Narzędzia', items: [INTEGRATIONS_NAV_ITEM, TRASH_NAV_ITEM] });
  }
  return sections;
}

interface RouteTitle {
  label: string;
  Icon: LucideIcon;
  parent?: { label: string; to: string };
}

const INTEGRATIONS_PARENT = { label: INTEGRATIONS_NAV_ITEM.label, to: INTEGRATIONS_NAV_ITEM.to };

/** Tytuł bieżącej strony (breadcrumb w TopBar) na podstawie ścieżki. */
export function getRouteTitle(rawPathname: string): RouteTitle | null {
  let pathname = rawPathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    // niepoprawne kodowanie - używamy surowej ścieżki
  }
  const path = pathname.replace(/\/+$/, '') || '/';

  if (/^\/biuro\/interpelacje\/[^/]+$/.test(path)) {
    return { label: 'Szczegóły', Icon: FileText, parent: { label: 'Interpelacje', to: '/biuro/interpelacje' } };
  }
  if (/^\/biuro\/dokumenty\/[^/]+$/.test(path)) {
    return { label: 'Szczegóły', Icon: Signature, parent: { label: 'Dokumenty do podpisu', to: '/biuro/dokumenty' } };
  }
  if (path === '/biuro/admin/integracje/getresponse') {
    return { label: 'GetResponse', Icon: Plug, parent: INTEGRATIONS_PARENT };
  }
  if (path === '/biuro/admin/integracje/ics') {
    return { label: 'Kalendarze ICS', Icon: Calendar, parent: INTEGRATIONS_PARENT };
  }
  if (path === '/biuro/admin/integracje/ai') {
    return { label: 'AI (Claude)', Icon: Sparkles, parent: INTEGRATIONS_PARENT };
  }
  if (path === '/biuro/admin/integracje/powiadomienia') {
    return { label: 'Powiadomienia', Icon: Bell, parent: INTEGRATIONS_PARENT };
  }
  if (path === '/biuro/admin/integracje/mcp') {
    return { label: 'Połączenie MCP', Icon: Plug, parent: INTEGRATIONS_PARENT };
  }
  if (path === PROFILE_NAV_ITEM.to) {
    return { label: PROFILE_NAV_ITEM.label, Icon: PROFILE_NAV_ITEM.Icon };
  }

  const match = ALL_NAV_ITEMS.find((item) => item.to === path);
  return match ? { label: match.label, Icon: match.Icon } : null;
}

/** Normalizacja do porównań w wyszukiwarce: małe litery, bez polskich znaków. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
}

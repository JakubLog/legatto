import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Pin, PinOff, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useRoleLabel } from '@/hooks/useMpForms';
import { useSiteContent } from '@/hooks/useSiteContent';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { BrandEmblem } from '@/components/common/BrandEmblem';
import { ProductCredit } from '@/components/common/ProductCredit';
import { useSearch } from '@/components/search/SearchProvider';
import { SEARCH_SHORTCUT_LABEL } from '@/components/search/constants';
import { PROFILE_NAV_ITEM } from './navigation';
import { useNavSections } from './useNavSections';

const PINNED_STORAGE_KEY = 'app.sidebar.pinned';
/** Opóźnienie rozwinięcia po najechaniu - przelot kursorem nad szyną nie otwiera panelu. */
const HOVER_OPEN_DELAY_MS = 120;

/** Etykiety znikają płynnie razem ze zwężaniem panelu; pozycje ikon się nie zmieniają. */
const fadeLabel = (collapsed: boolean) =>
  cn('transition-opacity duration-200 motion-reduce:transition-none', collapsed && 'opacity-0');

interface SidebarContentProps {
  /**
   * Wąska szyna z samymi ikonami (tylko desktop). Układ jest identyczny w obu stanach -
   * zmienia się tylko widoczność etykiet, więc animacja szerokości kontenera jest płynna.
   */
  collapsed?: boolean;
  /** Wywoływane po wyborze pozycji (np. zamknięcie szuflady mobilnej). */
  onNavigate?: () => void;
  /** Dodatkowa zawartość nad kartą użytkownika (np. przypięcie panelu). */
  footer?: ReactNode;
}

/** Wnętrze panelu nawigacji - wspólne dla sidebara desktop i szuflady mobilnej. */
export function SidebarContent({ collapsed = false, onNavigate, footer }: SidebarContentProps) {
  const { profile } = useAuth();
  const { setOpen: setSearchOpen } = useSearch();
  const sections = useNavSections();
  const roleLabel = useRoleLabel();
  // Podpis pod nazwą portalu: nazwisko posła z treści instancji; do czasu wczytania - nic (bez migania).
  const { data: site } = useSiteContent();
  const brandSubtitle = site ? site.identity.mp_name || site.identity.mp_title : '';

  return (
    <div className="flex h-full flex-col">
      {/* Przestrzeń robocza */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 overflow-hidden px-3">
        <BrandEmblem className="h-8 w-8 shrink-0 shadow-sm" />
        <div className={cn('min-w-0 whitespace-nowrap', fadeLabel(collapsed))}>
          <p className="truncate text-sm font-semibold text-foreground">Biuro Poselskie</p>
          {brandSubtitle && <p className="truncate text-xs text-sidebar-muted">{brandSubtitle}</p>}
        </div>
      </div>

      {/* Wyszukiwarka */}
      <div className="shrink-0 px-3 pb-2">
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            setSearchOpen(true);
          }}
          aria-label="Szukaj"
          className="flex h-11 w-full items-center gap-2 overflow-hidden whitespace-nowrap rounded-lg border border-sidebar-border bg-card px-2 text-sm text-sidebar-muted shadow-sm transition-colors hover:border-primary/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8"
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span className={cn('min-w-0 flex-1 truncate text-left', fadeLabel(collapsed))}>Szukaj...</span>
          <kbd
            className={cn(
              'hidden shrink-0 rounded border border-sidebar-border bg-sidebar px-1.5 font-sans text-[11px] font-medium md:inline-block',
              fadeLabel(collapsed),
            )}
          >
            {SEARCH_SHORTCUT_LABEL}
          </kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3" aria-label="Nawigacja główna">
        {sections.map((section) => (
          <div key={section.id}>
            {section.label && (
              <div
                className={cn(
                  'relative px-2.5 pb-1 pt-4',
                  section.items.every((item) => item.desktopOnly) && 'max-md:hidden',
                )}
              >
                {/* W szynie zamiast nazwy sekcji widać kreskę oddzielającą. */}
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-x-2 top-6 h-px bg-sidebar-border transition-opacity duration-200 motion-reduce:transition-none',
                    !collapsed && 'opacity-0',
                  )}
                />
                <p className={cn('truncate whitespace-nowrap text-xs font-medium text-sidebar-muted', fadeLabel(collapsed))}>
                  {section.label}
                </p>
              </div>
            )}
            <ul className="space-y-0.5">
              {section.items.map(({ to, label, Icon, end, desktopOnly }) => (
                <li key={to} className={cn(desktopOnly && 'max-md:hidden')}>
                  <NavLink
                    to={to}
                    end={end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex h-11 items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8',
                        isActive
                          ? 'bg-sidebar-accent font-medium text-primary'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className={cn('min-w-0 truncate', fadeLabel(collapsed))}>{label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-2">
        {footer}
        {profile && (
          <NavLink
            to={PROFILE_NAV_ITEM.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 overflow-hidden rounded-lg px-1 py-1.5 transition-colors hover:bg-sidebar-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive && 'bg-sidebar-accent',
              )
            }
          >
            <CreatorAvatar
              name={profile.full_name}
              avatarUrl={profile.avatar_url ? `${profile.avatar_url}?v=${profile.updated_at}` : null}
              className="h-8 w-8 shrink-0 ring-0"
              fallbackClassName="bg-primary text-xs text-primary-foreground"
            />
            <span className={cn('min-w-0 flex-1 whitespace-nowrap', fadeLabel(collapsed))}>
              <span className="block truncate text-sm font-medium text-foreground">{profile.full_name}</span>
              <span className="block truncate text-xs text-sidebar-muted">{roleLabel(profile.role)}</span>
            </span>
          </NavLink>
        )}
        <ProductCredit
          className={cn('whitespace-nowrap px-3 pb-1 pt-2 text-sidebar-muted', fadeLabel(collapsed))}
        />
      </div>
    </div>
  );
}

function readPinned(): boolean {
  try {
    return localStorage.getItem(PINNED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Sidebar desktop (md+): domyślnie wąska szyna z ikonami, rozwijana płynnie po najechaniu
 * (lub fokusie z klawiatury) jako nakładka nad treścią. Przypięty panel zajmuje stałe miejsce.
 */
export function Sidebar() {
  const [pinned, setPinned] = useState(readPinned);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const hoverTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    try {
      localStorage.setItem(PINNED_STORAGE_KEY, pinned ? '1' : '0');
    } catch {
      // localStorage niedostępny - stan tylko w pamięci
    }
  }, [pinned]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const expanded = pinned || hovered || keyboardFocused;
  const PinIcon = pinned ? PinOff : Pin;
  const pinLabel = pinned ? 'Odepnij panel' : 'Przypnij panel';

  const handleMouseEnter = () => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHovered(true), HOVER_OPEN_DELAY_MS);
  };

  const handleMouseLeave = () => {
    window.clearTimeout(hoverTimer.current);
    setHovered(false);
  };

  // Tylko fokus z klawiatury (:focus-visible) rozwija panel - kliknięcie myszą w link
  // nie może zostawić panelu otwartego po zjechaniu kursorem.
  const handleFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target.matches(':focus-visible')) setKeyboardFocused(true);
  };

  const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardFocused(false);
  };

  return (
    <aside
      className={cn(
        'relative hidden shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none md:block',
        pinned ? 'w-60' : 'w-14',
      )}
    >
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={cn(
          'absolute inset-y-0 left-0 z-40 overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none',
          expanded ? 'w-60' : 'w-14',
          expanded && !pinned && 'shadow-xl',
        )}
      >
        <SidebarContent
          collapsed={!expanded}
          footer={
            <button
              type="button"
              onClick={() => setPinned((p) => !p)}
              className="mb-1 flex h-8 w-full items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-lg px-3 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PinIcon className="h-4 w-4 shrink-0" aria-hidden />
              <span className={fadeLabel(!expanded)}>{pinLabel}</span>
            </button>
          }
        />
      </div>
    </aside>
  );
}

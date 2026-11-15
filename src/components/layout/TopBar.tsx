import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Eye, KeyRound, LogOut, Search, Settings, User as UserIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { isAdmin } from '@/lib/permissions';
import { isStandalonePwa } from '@/lib/pwa';
import { useRoleLabel } from '@/hooks/useMpForms';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { BrandEmblem } from '@/components/common/BrandEmblem';
import { PrivacySetupDialog } from '@/components/privacy/PrivacySetupDialog';
import { useSearch } from '@/components/search/SearchProvider';
import { SEARCH_SHORTCUT_LABEL } from '@/components/search/constants';
import { PoliAITrigger } from '@/components/poliai/PoliAITrigger';
import { NotificationBell } from '@/components/notifications/inbox/NotificationBell';
import { getRouteTitle } from './navigation';

/** Początek paska na mobile: powrót do rodzica albo znak portalu. */
function MobileHeaderStart() {
  const { pathname } = useLocation();
  const parent = getRouteTitle(pathname)?.parent;
  const linkClass =
    'flex h-11 min-w-0 items-center gap-2 rounded-lg pl-2 pr-2 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden';

  if (parent) {
    return (
      <Link to={parent.to} className={linkClass} aria-label={`Wróć do: ${parent.label}`}>
        <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden />
        <span className="truncate">{parent.label}</span>
      </Link>
    );
  }
  return (
    <Link to="/biuro" className={linkClass} aria-label="Pulpit">
      <BrandEmblem className="h-7 w-7 shrink-0" />
      <span className="truncate">Biuro</span>
    </Link>
  );
}

/** Tytuł bieżącej strony (desktop) - breadcrumb z ikoną. */
function RouteBreadcrumb() {
  const { pathname } = useLocation();
  const route = getRouteTitle(pathname);
  if (!route) return null;
  const { Icon, label, parent } = route;
  return (
    <nav aria-label="Ścieżka" className="hidden min-w-0 items-center gap-2 text-sm md:flex">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      {parent && (
        <>
          <Link to={parent.to} className="truncate text-muted-foreground transition-colors hover:text-foreground">
            {parent.label}
          </Link>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </>
      )}
      <span className="truncate font-medium text-foreground" aria-current="page">
        {label}
      </span>
    </nav>
  );
}

export function TopBar() {
  const { profile, signOut } = useAuth();
  const { isPinSet, lock } = usePrivacy();
  const roleLabel = useRoleLabel();
  const { setOpen: setSearchOpen } = useSearch();
  const navigate = useNavigate();
  const [setupOpen, setSetupOpen] = useState(false);

  if (!profile) return null;

  const handleSignOut = async () => {
    await signOut();
    // W zainstalowanej aplikacji nie pokazujemy publicznej strony głównej.
    navigate(isStandalonePwa() ? '/login' : '/', { replace: true });
  };

  const handleEnablePrivacy = () => {
    if (isPinSet) {
      lock();
    } else {
      setSetupOpen(true);
    }
  };

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b bg-card safe-top">
      <div className="flex h-14 items-center justify-between gap-3 px-2 md:px-6">
        <div className="flex min-w-0 items-center gap-1.5">
          <MobileHeaderStart />
          <RouteBreadcrumb />
        </div>

        {/* Telefon: przyciski mają stałe 44 px (nie rosną z rozmiarem tekstu), żeby przy 150%
            zmieściło się godło; ikony dalej w rem. */}
        <div className="flex shrink-0 items-center gap-1 md:gap-2">
          <PoliAITrigger />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setSearchOpen(true)}
            className="h-11 w-11 md:hidden max-md:h-[44px] max-md:w-[44px]"
            aria-label="Szukaj"
          >
            <Search className="h-5 w-5" />
          </Button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="hidden h-8 w-56 items-center gap-2 rounded-lg border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex lg:w-64"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1 text-left">Szukaj...</span>
            <kbd className="rounded border bg-card px-1.5 font-sans text-[11px] font-medium">
              {SEARCH_SHORTCUT_LABEL}
            </kbd>
          </button>

          {/* Telefon: tryb prywatny w menu konta (miejsce na dzwonek). */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleEnablePrivacy}
            className="hidden text-muted-foreground hover:text-foreground md:inline-flex md:h-9 md:w-9"
            aria-label="Włącz tryb prywatny"
            title="Włącz tryb prywatny"
          >
            <Eye className="h-4 w-4" />
          </Button>

          <NotificationBell />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 rounded-full md:h-10 md:w-10 max-md:h-[44px] max-md:w-[44px]"
                aria-label="Menu konta"
              >
                <CreatorAvatar
                  name={profile.full_name}
                  avatarUrl={profile.avatar_url ? `${profile.avatar_url}?v=${profile.updated_at}` : null}
                  className="h-8 w-8 ring-0 max-md:h-[32px] max-md:w-[32px]"
                  fallbackClassName="bg-primary text-xs text-primary-foreground"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{profile.full_name}</span>
                  <span className="text-xs font-normal text-muted-foreground">{profile.email}</span>
                  <span className="mt-1 text-xs font-normal text-muted-foreground">
                    Rola: {roleLabel(profile.role)}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/biuro/profil')}>
                <UserIcon className="h-4 w-4" />
                Mój profil
              </DropdownMenuItem>
              <DropdownMenuItem className="md:hidden" onClick={handleEnablePrivacy}>
                <Eye className="h-4 w-4" />
                Włącz tryb prywatny
              </DropdownMenuItem>
              {isPinSet && (
                <DropdownMenuItem onClick={() => setSetupOpen(true)}>
                  <KeyRound className="h-4 w-4" />
                  PIN trybu prywatnego
                </DropdownMenuItem>
              )}
              {isAdmin(profile.role) && (
                <DropdownMenuItem onClick={() => navigate('/biuro/admin/użytkownicy')}>
                  <Settings className="h-4 w-4" />
                  Użytkownicy
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="h-4 w-4" />
                Wyloguj się
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <PrivacySetupDialog open={setupOpen} onOpenChange={setSetupOpen} />
    </header>
  );
}

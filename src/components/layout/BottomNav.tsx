import { useEffect, useState, type ReactNode } from 'react';
import { matchPath, NavLink, useLocation } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Briefcase, Calendar, Home, Menu, Users, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SidebarContent } from './Sidebar';

const items = [
  { to: '/biuro', label: 'Pulpit', Icon: Home, end: true },
  { to: '/biuro/sprawy', label: 'Sprawy', Icon: Briefcase, end: false },
  { to: '/biuro/kontakty', label: 'Kontakty', Icon: Users, end: false },
  { to: '/biuro/kalendarz', label: 'Kalendarz', Icon: Calendar, end: false },
];

const TAB_CLASS =
  'group relative flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] transition-colors focus-visible:outline-none';

function TabFace({ Icon, label, isActive }: { Icon: LucideIcon; label: ReactNode; isActive: boolean }) {
  return (
    <>
      <span
        className={cn(
          'absolute left-1/2 top-0 h-[3px] w-8 -translate-x-1/2 rounded-b-full bg-primary transition-opacity',
          isActive ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden
      />
      <span
        className={cn(
          'flex h-7 w-12 items-center justify-center rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring',
          isActive ? 'bg-primary/10' : 'group-hover:bg-muted',
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      {/* Przy powiększonym tekście (ustawienia dostępności) etykiety nie zlewają się z sąsiednimi. */}
      <span className="max-w-full truncate px-0.5">{label}</span>
    </>
  );
}

function tabTone(isActive: boolean) {
  return isActive ? 'font-medium text-primary' : 'text-muted-foreground active:text-foreground';
}

/** Zakładka "Więcej": szuflada z pełną nawigacją (pozostałe sekcje i administracja). */
function MoreTab({ isActive }: { isActive: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    closeOnDesktop();
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        className={cn(TAB_CLASS, tabTone(isActive))}
        aria-current={isActive ? 'page' : undefined}
      >
        <TabFace Icon={Menu} label="Więcej" isActive={isActive} />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 md:hidden" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[300px] border-r border-sidebar-border bg-sidebar shadow-xl safe-top safe-bottom duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left md:hidden">
          <DialogPrimitive.Title className="sr-only">Menu nawigacji</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Wszystkie sekcje portalu dostępne dla Twojej roli.
          </DialogPrimitive.Description>
          <SidebarContent onNavigate={() => setOpen(false)} />
          <DialogPrimitive.Close asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-[calc(env(safe-area-inset-top)+0.5rem)] h-10 w-10 text-sidebar-muted"
              aria-label="Zamknij menu"
            >
              <X className="h-5 w-5" />
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function BottomNav() {
  const { pathname } = useLocation();
  const onTab = items.some(({ to, end }) => matchPath({ path: to, end }, pathname) != null);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/90 shadow-[0_-1px_12px_-6px_hsl(var(--foreground)/0.15)] backdrop-blur-md safe-bottom supports-[backdrop-filter]:bg-card/80 md:hidden"
      aria-label="Nawigacja dolna"
    >
      <ul className="grid grid-cols-5">
        {items.map(({ to, label, Icon, end }) => (
          <li key={to}>
            <NavLink to={to} end={end} className={({ isActive }) => cn(TAB_CLASS, tabTone(isActive))}>
              {({ isActive }) => <TabFace Icon={Icon} label={label} isActive={isActive} />}
            </NavLink>
          </li>
        ))}
        <li>
          <MoreTab isActive={!onTab} />
        </li>
      </ul>
    </nav>
  );
}

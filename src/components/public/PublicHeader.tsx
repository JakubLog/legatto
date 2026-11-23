import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, ExternalLink, Menu, X } from 'lucide-react';
import { officeFullName, type HomepageContent, type SiteIdentity } from '@/lib/siteContent';
import { cn } from '@/lib/utils';
import { externalProps, isExternalUrl, type PublicNavItem } from '@/components/public/publicNav';
import { publicContainer, publicFocus, publicInner, publicSkeleton } from '@/components/public/styles';

const MOBILE_MENU_ID = 'public-mobile-menu';

/** Logo + "Biuro Poselskie" + imię i nazwisko posła; `name === null` - szkielet podczas ładowania treści. */
export function PublicBrandMark({ variant, name }: { variant: 'header' | 'footer'; name: string | null }) {
  const isHeader = variant === 'header';
  return (
    <>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand">
        <img src="/logo.svg" alt="" width={28} height={32} className="h-8 w-auto" />
      </span>
      <span className={cn('flex-col leading-tight', isHeader ? 'hidden min-[360px]:flex' : 'flex')}>
        <span className={cn('text-[15px] font-bold', isHeader ? 'text-foreground' : 'text-primary-foreground')}>
          Biuro Poselskie
        </span>
        {name === null ? (
          <span className={cn(publicSkeleton, 'mt-1 h-3 w-28 rounded-[4px]')} aria-hidden />
        ) : (
          name && (
            <span className={cn('text-[12.5px]', isHeader ? 'text-muted-foreground' : 'text-primary-foreground/75')}>
              {name}
            </span>
          )
        )}
      </span>
    </>
  );
}

/** Kotwica z adresu (#biura) - aktywna pozycja menu; po stronie serwera zawsze pusta (zgodna hydratacja). */
function useLocationHash(): string {
  const [hash, setHash] = useState('');
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    update();
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return hash;
}

export interface PublicHeaderProps {
  identity: SiteIdentity;
  promo: HomepageContent['promo'];
  /** Sekcje strony, podstrony i linki zewnętrzne w kolejności menu. */
  navLinks: PublicNavItem[];
  /** Treść strony jeszcze się wczytuje (SPA): szkielet nazwiska, bez belki promocyjnej. */
  loading?: boolean;
  /**
   * Link do portalu biura - tylko SPA. Strona statyczna posła go nie ma (nie zdradza adresu portalu).
   * `closeMenu` zamyka menu mobilne po kliknięciu.
   */
  renderPortalLink?: (variant: 'desktop' | 'mobile', closeMenu: () => void) => ReactNode;
}

/** Belka promocyjna i nagłówek strony publicznej z menu mobilnym (na stronie statycznej - wyspa). */
export function PublicHeader({ identity, promo, navLinks, loading = false, renderPortalLink }: PublicHeaderProps) {
  const hash = useLocationHash();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  const showPromo = !loading && promo.enabled && Boolean(promo.href);
  const promoExternal = isExternalUrl(promo.href);
  const officeName = officeFullName(identity);
  const mobilePortal = renderPortalLink?.('mobile', closeMenu);

  return (
    <>
      {/* Belka promocyjna (treść z panelu admina) */}
      {showPromo && (
        <a
          href={promo.href}
          {...externalProps(promoExternal)}
          className={cn(
            'safe-top group block bg-brand text-brand-foreground transition-colors hover:bg-brand-end',
            publicFocus,
            'focus-visible:outline-offset-[-3px] focus-visible:outline-brand-foreground',
          )}
        >
          <span className={cn(publicContainer, 'block')}>
            <span className={cn(publicInner, 'flex min-h-9 items-center justify-center gap-x-1.5 py-2 text-center text-[13px] sm:text-sm')}>
              <span>
                {promo.label && <span className="text-brand-foreground/80">{promo.label}</span>}
                {promo.label && promo.name && ' '}
                {promo.name && <strong className="font-semibold">{promo.name}</strong>}
                {promo.text && (
                  <span className="hidden text-brand-foreground/90 md:inline">
                    {promo.label || promo.name ? ' - ' : ''}
                    {promo.text}
                  </span>
                )}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 font-semibold underline-offset-2 group-hover:underline">
                {promo.cta && <span className="hidden sm:inline">{promo.cta}</span>}
                {promoExternal ? (
                  <>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">(otwiera się w nowej karcie)</span>
                  </>
                ) : (
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                )}
              </span>
            </span>
          </span>
        </a>
      )}

      <header className="safe-top sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-[8px]">
        <div className={publicContainer}>
          <div className={cn(publicInner, 'flex h-16 items-center justify-between gap-3 md:h-[74px]')}>
            <a
              href="/"
              className={cn('flex min-h-11 items-center gap-3 rounded-lg', publicFocus)}
              aria-label={`${officeName} - strona główna`}
              onClick={closeMenu}
            >
              <PublicBrandMark variant="header" name={loading ? null : identity.mp_name} />
            </a>

            <nav aria-label="Sekcje strony" className="hidden items-center gap-1 lg:flex">
              {navLinks.map((item) => {
                const active = !item.external && hash !== '' && hash === item.href;
                return (
                  <a
                    key={`${item.href}|${item.label}`}
                    href={item.href}
                    {...externalProps(item.external)}
                    aria-current={active ? 'location' : undefined}
                    className={cn(
                      'inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-[14.5px] transition-colors hover:bg-cream-2',
                      active ? 'font-semibold text-brand' : 'font-medium text-foreground',
                      publicFocus,
                    )}
                  >
                    {item.label}
                    {item.external && <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
                  </a>
                );
              })}
            </nav>

            <div className="flex items-center gap-2">
              {renderPortalLink?.('desktop', closeMenu)}

              <button
                type="button"
                className={cn(
                  'inline-flex h-11 w-11 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-cream-2 lg:hidden',
                  publicFocus,
                )}
                aria-expanded={menuOpen}
                aria-controls={MOBILE_MENU_ID}
                aria-label={menuOpen ? 'Zamknij menu' : 'Otwórz menu'}
                onClick={() => setMenuOpen((open) => !open)}
              >
                {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {menuOpen && (
          <nav id={MOBILE_MENU_ID} aria-label="Sekcje strony" className="border-t border-border bg-background lg:hidden">
            <ul className={cn(publicContainer, 'flex flex-col gap-1 py-3')}>
              {navLinks.map((item) => (
                <li key={`${item.href}|${item.label}`}>
                  <a
                    href={item.href}
                    {...externalProps(item.external)}
                    onClick={closeMenu}
                    className={cn(
                      'flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-[15px] font-medium transition-colors hover:bg-cream-2',
                      !item.external && hash !== '' && hash === item.href ? 'font-semibold text-brand' : 'text-foreground',
                      publicFocus,
                    )}
                  >
                    {item.label}
                    {item.external && <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden />}
                  </a>
                </li>
              ))}
              {mobilePortal && <li className={cn(navLinks.length > 0 && 'mt-1 border-t border-border pt-1')}>{mobilePortal}</li>}
            </ul>
          </nav>
        )}
      </header>
    </>
  );
}

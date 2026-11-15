import { Suspense, useEffect, useLayoutEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ArrowRight, ExternalLink, LogIn, Menu, X } from 'lucide-react';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/600.css';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useAccessibilitySettings } from '@/hooks/useAccessibilitySettings';
import { useSiteContent } from '@/hooks/useSiteContent';
import { cacheAppearance, publicThemeVars, readCachedAppearance } from '@/lib/publicTheme';
import {
  DEFAULT_SITE_CONTENT,
  HOMEPAGE_SECTION_ANCHORS,
  officeFullName,
  type HomepageContent,
} from '@/lib/siteContent';
import { cn } from '@/lib/utils';
import { PublicPageSkeleton } from '@/components/public/PublicPageSkeleton';
import { ProductCredit } from '@/components/common/ProductCredit';
import { publicBtn, publicContainer, publicFocus, publicInner, publicSkeleton } from '@/components/public/styles';

const THEME_CLASS = 'theme-public';
const TEMPLATE_ATTR = 'data-public-template';
const MOBILE_MENU_ID = 'public-mobile-menu';

interface NavItem {
  href: string;
  label: string;
  external?: boolean;
}

const isExternalUrl = (href: string) => /^https?:\/\//i.test(href);

function externalProps(external: boolean | undefined) {
  return external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}

/** "https://www.example.com/o-mnie" -> "example.com"; adres względny zostaje bez zmian. */
function displayHost(href: string): string {
  if (!isExternalUrl(href)) return href;
  try {
    return new URL(href).hostname.replace(/^www\./i, '');
  } catch {
    return href;
  }
}

/**
 * Motyw publiczny musi siedzieć na <html>, żeby portale Radix (Select, Dialog, toasty)
 * renderowane poza drzewem layoutu też go dziedziczyły. useLayoutEffect - bez mignięcia
 * granatowego motywu przed pierwszym malowaniem; cleanup przywraca motyw portalu.
 * Do odpowiedzi RPC (`appearance === null`) ostatni zapamiętany wygląd, potem z treści strony.
 */
function usePublicTheme(appearance: HomepageContent['appearance'] | null) {
  const { highContrast } = useAccessibilitySettings().settings;
  const [cached] = useState(readCachedAppearance);
  const effective = appearance ?? cached ?? DEFAULT_SITE_CONTENT.homepage.appearance;
  const { template, brand_color } = effective;

  useLayoutEffect(() => {
    const root = document.documentElement;
    const vars = publicThemeVars({ template, brand_color }, highContrast);
    root.classList.add(THEME_CLASS);
    root.setAttribute(TEMPLATE_ATTR, template);
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    return () => {
      root.classList.remove(THEME_CLASS);
      root.removeAttribute(TEMPLATE_ATTR);
      for (const name of Object.keys(vars)) root.style.removeProperty(name);
    };
  }, [template, brand_color, highContrast]);

  useEffect(() => {
    if (appearance) cacheAppearance({ template: appearance.template, brand_color: appearance.brand_color });
  }, [appearance]);
}

/**
 * <title> i meta description strony publicznej z treści instancji. Portal (/biuro, /login)
 * korzysta z wartości z index.html, więc cleanup przywraca poprzednie wartości.
 * `title === null` - treść jeszcze się ładuje, nic nie zmieniamy.
 */
function useDocumentMeta(title: string | null, description: string) {
  useEffect(() => {
    if (title === null) return;
    const prevTitle = document.title;
    const tag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDescription = tag?.getAttribute('content') ?? null;
    document.title = title;
    if (tag && description) tag.setAttribute('content', description);
    return () => {
      document.title = prevTitle;
      if (tag && prevDescription !== null) tag.setAttribute('content', prevDescription);
    };
  }, [title, description]);
}

/** Logo + "Biuro Poselskie" + imię i nazwisko posła; `name === null` - szkielet podczas ładowania treści. */
function BrandMark({ variant, name }: { variant: 'header' | 'footer'; name: string | null }) {
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

const footerLink = cn(
  'inline-flex min-h-10 items-center rounded transition-colors hover:text-primary-foreground md:min-h-9',
  publicFocus,
);

export function PublicLayout() {
  const { session, profile } = useAuth();
  const loggedIn = Boolean(session && profile);
  const { hash } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const year = new Date().getFullYear();

  // Do odpowiedzi RPC nie pokazujemy neutralnych domyślnych tekstów (mignięcie);
  // błąd odczytu -> domyślne, strona dalej działa.
  const siteQ = useSiteContent();
  const siteLoading = siteQ.isPending;
  const { identity, homepage } = siteQ.data ?? DEFAULT_SITE_CONTENT;
  usePublicTheme(siteLoading ? null : homepage.appearance);
  useDocumentMeta(siteLoading ? null : homepage.seo.title, homepage.seo.description);

  const enabledSections = siteLoading ? [] : homepage.sections.filter((s) => s.enabled);
  const officesEnabled = enabledSections.some((s) => s.id === 'offices');
  const sectionLinks: NavItem[] = enabledSections.map((s) => ({
    href: `#${HOMEPAGE_SECTION_ANCHORS[s.id]}`,
    label: homepage[s.id].nav_label,
  }));
  const navLinks: NavItem[] = siteLoading
    ? []
    : [...sectionLinks, ...homepage.external_links.map((link) => ({ href: link.href, label: link.label, external: true }))];

  const { promo } = homepage;
  const showPromo = !siteLoading && promo.enabled && Boolean(promo.href);
  const promoExternal = isExternalUrl(promo.href);
  const websiteUrl = identity.website_url;
  const websiteExternal = isExternalUrl(websiteUrl);
  const officeName = officeFullName(identity);

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
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
            <Link
              to="/"
              className={cn('flex min-h-11 items-center gap-3 rounded-lg', publicFocus)}
              aria-label={`${officeName} - strona główna`}
              onClick={() => setMenuOpen(false)}
            >
              <BrandMark variant="header" name={siteLoading ? null : identity.mp_name} />
            </Link>

            <nav aria-label="Sekcje strony" className="hidden items-center gap-1 lg:flex">
              {navLinks.map((item) => {
                const active = !item.external && hash === item.href;
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
              {loggedIn ? (
                <Button
                  asChild
                  variant="brand"
                  className={cn(publicBtn.primary, 'hidden min-h-10 px-5 py-2 text-sm sm:inline-flex')}
                >
                  <Link to="/biuro">
                    Przejdź do portalu
                    <ArrowRight />
                  </Link>
                </Button>
              ) : (
                <Button
                  asChild
                  variant="outline"
                  className={cn(publicBtn.ghost, 'hidden min-h-10 px-5 py-2 text-sm sm:inline-flex')}
                >
                  <Link to="/login">
                    <LogIn />
                    Logowanie pracowników
                  </Link>
                </Button>
              )}

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
          <nav
            id={MOBILE_MENU_ID}
            aria-label="Sekcje strony"
            className="border-t border-border bg-background lg:hidden"
          >
            <ul className={cn(publicContainer, 'flex flex-col gap-1 py-3')}>
              {navLinks.map((item) => (
                <li key={`${item.href}|${item.label}`}>
                  <a
                    href={item.href}
                    {...externalProps(item.external)}
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      'flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-[15px] font-medium transition-colors hover:bg-cream-2',
                      !item.external && hash === item.href ? 'font-semibold text-brand' : 'text-foreground',
                      publicFocus,
                    )}
                  >
                    {item.label}
                    {item.external && <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden />}
                  </a>
                </li>
              ))}
              <li className={cn(navLinks.length > 0 && 'mt-1 border-t border-border pt-1')}>
                <Link
                  to={loggedIn ? '/biuro' : '/login'}
                  onClick={() => setMenuOpen(false)}
                  className={cn(
                    'flex min-h-11 items-center gap-2 rounded-lg px-3 text-[15px] font-semibold text-brand transition-colors hover:bg-cream-2',
                    publicFocus,
                  )}
                >
                  {loggedIn ? <ArrowRight className="h-4 w-4" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
                  {loggedIn ? 'Przejdź do portalu' : 'Logowanie pracowników'}
                </Link>
              </li>
            </ul>
          </nav>
        )}
      </header>

      <main className="flex-1">
        <Suspense fallback={<PublicPageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>

      {!siteLoading && (
        <footer className="bg-primary text-[13.5px] leading-relaxed text-primary-foreground/75">
          <div className={publicContainer}>
            <div className={cn(publicInner, 'pb-7 pt-14')}>
              <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr] md:gap-9">
                {/* 1. Marka */}
                <div className="sm:col-span-2 md:col-span-1">
                  <Link to="/" className={cn('inline-flex items-center gap-3 rounded-lg', publicFocus)}>
                    <BrandMark variant="footer" name={identity.mp_name} />
                  </Link>
                  {homepage.footer.tagline && <p className="mt-4 max-w-xs">{homepage.footer.tagline}</p>}
                </div>

                {/* 2. Na stronie */}
                {sectionLinks.length > 0 && (
                  <div>
                    <h2 className="mb-2 text-sm font-semibold text-primary-foreground">Na stronie</h2>
                    <ul>
                      {sectionLinks.map((item) => (
                        <li key={item.href}>
                          <a href={item.href} className={footerLink}>
                            {item.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 3. Kontakt */}
                {(officesEnabled || websiteUrl) && (
                  <div>
                    <h2 className="mb-2 text-sm font-semibold text-primary-foreground">Kontakt</h2>
                    <ul>
                      {officesEnabled && (
                        <li>
                          <a href={`#${HOMEPAGE_SECTION_ANCHORS.offices}`} className={footerLink}>
                            Adresy i telefony biur
                          </a>
                        </li>
                      )}
                      {websiteUrl && (
                        <li>
                          <a href={websiteUrl} {...externalProps(websiteExternal)} className={cn(footerLink, 'gap-1.5')}>
                            {displayHost(websiteUrl)}
                            {websiteExternal && <ExternalLink className="h-3.5 w-3.5" aria-hidden />}
                          </a>
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>

              <div className="mt-10 flex flex-col gap-3 border-t border-primary-foreground/10 pt-6 text-[12.5px] text-primary-foreground/65 sm:flex-row sm:items-center sm:justify-between">
                <p>
                  © {year} {homepage.footer.copyright || officeName}
                </p>
                {loggedIn ? (
                  <Link
                    to="/biuro"
                    className={cn(
                      'inline-flex min-h-10 items-center gap-1.5 rounded font-medium text-primary-foreground/85 transition-colors hover:text-primary-foreground sm:min-h-0',
                      publicFocus,
                    )}
                  >
                    Przejdź do portalu
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                ) : (
                  <Link
                    to="/login"
                    className={cn(
                      'inline-flex min-h-10 items-center gap-1.5 rounded font-medium text-primary-foreground/85 transition-colors hover:text-primary-foreground sm:min-h-0',
                      publicFocus,
                    )}
                  >
                    <LogIn className="h-3.5 w-3.5" aria-hidden />
                    Logowanie pracowników
                  </Link>
                )}
              </div>
              <ProductCredit className="mt-4 text-primary-foreground/55" />
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

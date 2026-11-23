import { Suspense, useEffect, useLayoutEffect, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { ArrowRight, LogIn } from 'lucide-react';
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
import { EMPTY_PUBLIC_SITE, usePublicSite } from '@/hooks/usePublicSite';
import { cacheAppearance, publicThemeVars, readCachedAppearance } from '@/lib/publicTheme';
import { DEFAULT_SITE_CONTENT, type HomepageContent } from '@/lib/siteContent';
import { cn } from '@/lib/utils';
import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHeader } from '@/components/public/PublicHeader';
import { PublicPageSkeleton } from '@/components/public/PublicPageSkeleton';
import { externalNavLinks, officesHref, sectionNavLinks } from '@/components/public/publicNav';
import { publicBtn, publicFocus } from '@/components/public/styles';

// Strona publiczna w SPA (tryb Vercel i podgląd w CRM). Dane z GET /api/public-site (usePublicSite);
// te same komponenty (PublicHeader, PublicFooter, PublicHome) renderuje generator strony statycznej
// posła (site/), który nie ma linków do portalu biura.

const THEME_CLASS = 'theme-public';
const TEMPLATE_ATTR = 'data-public-template';

/**
 * Motyw publiczny musi siedzieć na <html>, żeby portale Radix (Select, Dialog, toasty)
 * renderowane poza drzewem layoutu też go dziedziczyły. useLayoutEffect - bez mignięcia
 * granatowego motywu przed pierwszym malowaniem; cleanup przywraca motyw portalu.
 * Do odpowiedzi API (`appearance === null`) ostatni zapamiętany wygląd, potem z treści strony.
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

const footerPortalLink = cn(
  'inline-flex min-h-10 items-center gap-1.5 rounded font-medium text-primary-foreground/85 transition-colors hover:text-primary-foreground sm:min-h-0',
  publicFocus,
);

export function PublicLayout() {
  const { session, profile } = useAuth();
  const loggedIn = Boolean(session && profile);
  const portalHref = loggedIn ? '/biuro' : '/login';
  const portalLabel = loggedIn ? 'Przejdź do portalu' : 'Logowanie pracowników';

  // Do odpowiedzi API nie pokazujemy neutralnych domyślnych tekstów (mignięcie);
  // błąd odczytu -> domyślne, strona dalej działa.
  const siteQ = usePublicSite();
  const siteLoading = siteQ.isPending;
  const { identity, homepage } = siteQ.data ?? EMPTY_PUBLIC_SITE;
  usePublicTheme(siteLoading ? null : homepage.appearance);
  useDocumentMeta(siteLoading ? null : homepage.seo.title, homepage.seo.description);

  const sectionLinks = siteLoading ? [] : sectionNavLinks(homepage);
  const navLinks = siteLoading ? [] : [...sectionLinks, ...externalNavLinks(homepage)];

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <PublicHeader
        identity={identity}
        promo={homepage.promo}
        navLinks={navLinks}
        loading={siteLoading}
        renderPortalLink={(variant, closeMenu) =>
          variant === 'desktop' ? (
            <Button
              asChild
              variant={loggedIn ? 'brand' : 'outline'}
              className={cn(loggedIn ? publicBtn.primary : publicBtn.ghost, 'hidden min-h-10 px-5 py-2 text-sm sm:inline-flex')}
            >
              <Link to={portalHref}>
                {!loggedIn && <LogIn />}
                {portalLabel}
                {loggedIn && <ArrowRight />}
              </Link>
            </Button>
          ) : (
            <Link
              to={portalHref}
              onClick={closeMenu}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-lg px-3 text-[15px] font-semibold text-brand transition-colors hover:bg-cream-2',
                publicFocus,
              )}
            >
              {loggedIn ? <ArrowRight className="h-4 w-4" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
              {portalLabel}
            </Link>
          )
        }
      />

      <main className="flex-1">
        <Suspense fallback={<PublicPageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>

      {!siteLoading && (
        <PublicFooter
          identity={identity}
          footer={homepage.footer}
          sectionLinks={sectionLinks}
          officesHref={officesHref(homepage)}
          year={new Date().getFullYear()}
          portalLink={
            <Link to={portalHref} className={footerPortalLink}>
              {!loggedIn && <LogIn className="h-3.5 w-3.5" aria-hidden />}
              {portalLabel}
              {loggedIn && <ArrowRight className="h-3.5 w-3.5" aria-hidden />}
            </Link>
          }
        />
      )}
    </div>
  );
}

import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { officeFullName, type HomepageContent, type SiteIdentity } from '@/lib/siteContent';
import { cn } from '@/lib/utils';
import { ProductCredit } from '@/components/common/ProductCredit';
import { PublicBrandMark } from '@/components/public/PublicHeader';
import { externalProps, isExternalUrl, type PublicNavItem } from '@/components/public/publicNav';
import { publicContainer, publicFocus, publicInner } from '@/components/public/styles';

const publicFooterLink = cn(
  'inline-flex min-h-10 items-center rounded transition-colors hover:text-primary-foreground md:min-h-9',
  publicFocus,
);

/** "https://www.example.com/o-mnie" -> "example.com"; adres względny zostaje bez zmian. */
function displayHost(href: string): string {
  if (!isExternalUrl(href)) return href;
  try {
    return new URL(href).hostname.replace(/^www\./i, '');
  } catch {
    return href;
  }
}

export interface PublicFooterProps {
  identity: SiteIdentity;
  footer: HomepageContent['footer'];
  /** Linki do sekcji strony (kolumna „Na stronie”). */
  sectionLinks: PublicNavItem[];
  /** Kotwica sekcji biur albo null, gdy sekcja jest wyłączona. */
  officesHref: string | null;
  year: number;
  /** Link do portalu biura - tylko SPA (strona statyczna go nie ma). */
  portalLink?: ReactNode;
}

/** Stopka strony publicznej (bez stanu - na stronie statycznej czysty HTML). */
export function PublicFooter({ identity, footer, sectionLinks, officesHref, year, portalLink }: PublicFooterProps) {
  const websiteUrl = identity.website_url;
  const websiteExternal = isExternalUrl(websiteUrl);

  return (
    <footer className="bg-primary text-[13.5px] leading-relaxed text-primary-foreground/75">
      <div className={publicContainer}>
        <div className={cn(publicInner, 'pb-7 pt-14')}>
          <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr] md:gap-9">
            {/* 1. Marka */}
            <div className="sm:col-span-2 md:col-span-1">
              <a href="/" className={cn('inline-flex items-center gap-3 rounded-lg', publicFocus)}>
                <PublicBrandMark variant="footer" name={identity.mp_name} />
              </a>
              {footer.tagline && <p className="mt-4 max-w-xs">{footer.tagline}</p>}
            </div>

            {/* 2. Na stronie */}
            {sectionLinks.length > 0 && (
              <div>
                <h2 className="mb-2 text-sm font-semibold text-primary-foreground">Na stronie</h2>
                <ul>
                  {sectionLinks.map((item) => (
                    <li key={item.href}>
                      <a href={item.href} className={publicFooterLink}>
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 3. Kontakt */}
            {(officesHref || websiteUrl) && (
              <div>
                <h2 className="mb-2 text-sm font-semibold text-primary-foreground">Kontakt</h2>
                <ul>
                  {officesHref && (
                    <li>
                      <a href={officesHref} className={publicFooterLink}>
                        Adresy i telefony biur
                      </a>
                    </li>
                  )}
                  {websiteUrl && (
                    <li>
                      <a href={websiteUrl} {...externalProps(websiteExternal)} className={cn(publicFooterLink, 'gap-1.5')}>
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
              © {year} {footer.copyright || officeFullName(identity)}
            </p>
            {portalLink}
          </div>
          <ProductCredit className="mt-4 text-primary-foreground/55" />
        </div>
      </div>
    </footer>
  );
}

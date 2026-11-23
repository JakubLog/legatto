import { HOMEPAGE_SECTION_ANCHORS, type HomepageContent } from '@/lib/siteContent';

/** Pozycja nawigacji strony publicznej (sekcja strony głównej, podstrona albo link zewnętrzny). */
export interface PublicNavItem {
  href: string;
  label: string;
  external?: boolean;
}

export const isExternalUrl = (href: string) => /^https?:\/\//i.test(href);

export function externalProps(external: boolean | undefined) {
  return external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}

/**
 * Linki do włączonych sekcji strony głównej w kolejności z panelu. `base` = '' na stronie głównej
 * (same kotwice) albo '/' na podstronach strony statycznej (np. /blog/ -> /#biura).
 */
export function sectionNavLinks(homepage: HomepageContent, base: '' | '/' = ''): PublicNavItem[] {
  return homepage.sections
    .filter((s) => s.enabled)
    .map((s) => ({ href: `${base}#${HOMEPAGE_SECTION_ANCHORS[s.id]}`, label: homepage[s.id].nav_label }));
}

/** Linki zewnętrzne z panelu admina (np. „O Pośle”). */
export function externalNavLinks(homepage: HomepageContent): PublicNavItem[] {
  return homepage.external_links.map((link) => ({ href: link.href, label: link.label, external: true }));
}

/** Kotwica sekcji biur, gdy sekcja jest włączona (stopka „Adresy i telefony biur”), inaczej null. */
export function officesHref(homepage: HomepageContent, base: '' | '/' = ''): string | null {
  return homepage.sections.some((s) => s.id === 'offices' && s.enabled) ? `${base}#${HOMEPAGE_SECTION_ANCHORS.offices}` : null;
}

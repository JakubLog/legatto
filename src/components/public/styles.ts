/**
 * Wspólne klasy strony publicznej (motyw `.theme-public`, szablony w src/lib/publicTheme.ts).
 * Kolory pochodzą ze zmiennych motywu: brand = kolor przewodni posła, primary = ciemna stopka,
 * background = tło strony, cream-2 = tło alternatywne, card = karty; zaokrąglenie kart
 * `--public-radius-card`, przycisków i pól `--radius` (rounded-lg) - zależą od szablonu.
 */

/** Kontener sekcji - wspólna szerokość treści. */
export const publicContainer = 'container px-4 md:px-6';
export const publicInner = 'mx-auto max-w-6xl';

/** Odstępy pionowe zwykłej sekcji (48px mobile, 80px desktop). */
export const publicSection = 'py-12 md:py-20';

/** Nadtytuł w kolorze przewodnim nad nagłówkiem sekcji. */
export const publicKicker = 'text-[13px] font-bold uppercase tracking-[0.12em] text-brand';

export const publicH1 = 'text-[clamp(34px,5vw,56px)] font-extrabold leading-[1.15] tracking-[-0.015em]';
export const publicH2 = 'text-[clamp(26px,3.4vw,38px)] font-bold leading-[1.2] tracking-[-0.01em]';

const btnBase =
  'h-auto min-h-11 rounded-lg border-2 px-[26px] py-[11px] text-[15px] font-semibold shadow-none hover:shadow-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:ring-0 focus-visible:ring-offset-0';

/** Klasy dla <Button>: primary z variant="brand", ghost z variant="outline", dark z variant="default". */
export const publicBtn = {
  primary: `${btnBase} border-brand bg-brand text-brand-foreground hover:border-brand-end hover:bg-brand-end active:bg-brand-end focus-visible:outline-foreground`,
  ghost: `${btnBase} border-brand bg-transparent text-brand hover:border-brand hover:bg-brand hover:text-brand-foreground focus-visible:outline-brand`,
  dark: `${btnBase} border-primary bg-primary text-primary-foreground hover:border-primary-end hover:bg-primary-end active:bg-primary-end focus-visible:outline-brand`,
} as const;

/** Karta z cienką ramką; `publicCardHover` dodaje uniesienie przy najechaniu. */
export const publicCard = 'rounded-[var(--public-radius-card)] border border-border bg-card';
export const publicCardHover =
  'transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-[0_10px_24px_hsl(var(--foreground)/0.10)] motion-reduce:transition-none motion-reduce:hover:translate-y-0';

/** Mała etykieta (tag). */
export const publicTag =
  'inline-flex items-center gap-1.5 rounded-[4px] bg-cream-2 px-2 py-1 text-[11px] font-bold uppercase leading-none tracking-[0.06em] text-foreground';

/** Kafelek z ikoną. */
export const publicIconTile = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-cream-2 text-brand';

/** Pola formularza - kremowe tło, ramka 1.5px (16px na mobile, by iOS nie powiększał). */
export const publicField =
  'h-auto min-h-11 rounded-lg border-[1.5px] border-input bg-cream px-3.5 py-3 text-base shadow-none hover:border-foreground/25 focus-visible:border-brand md:text-[15px]';

/** Skeleton treści w odcieniu tła alternatywnego. */
export const publicSkeleton = 'animate-pulse rounded-[var(--public-radius-card)] bg-cream-2';

/** Wyraźny focus dla elementów interaktywnych innych niż <Button>. */
export const publicFocus =
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand';

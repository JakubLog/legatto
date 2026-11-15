import { HEX_COLOR, type HomepageContent, type HomepageSectionId, type PublicTemplateId } from '@/lib/siteContent';

// Szablony wyglądu strony publicznej (`/`) i kolor przewodni posła (homepage.appearance).
// Jedno źródło: paleta, fonty i zaokrąglenia szablonu trafiają jako zmienne CSS na <html>
// (PublicLayout, useLayoutEffect), więc dziedziczą je też portale Radix; te same dane rysują
// miniatury w panelu (AppearanceCard). Typografię nagłówków (krój, wersaliki) dokłada CSS
// po atrybucie `data-public-template` (src/index.css, blok "Szablony strony publicznej").
// Kolor przewodni jest dociągany jasnością do kontrastu WCAG AA (4.5:1, w trybie wysokiego
// kontrastu 7:1) z tłem i kartą szablonu - tekst w kolorze przewodnim zawsze jest czytelny.

/** Kolor "H S% L%" - format zmiennych motywu shadcn (`hsl(var(--x))`). */
type Hsl = string;

type PaletteVar =
  | 'cream'
  | 'cream-2'
  | 'background'
  | 'foreground'
  | 'card'
  | 'muted'
  | 'muted-foreground'
  | 'primary'
  | 'primary-foreground'
  | 'primary-end'
  | 'destructive'
  | 'border'
  | 'input';

/**
 * Pierwszy ekran: split - zdjęcie po prawej, split-reverse - zdjęcie po lewej,
 * centered - wyśrodkowany tytuł z okrągłym portretem, band - jak split na kolorze przewodnim.
 */
export type PublicHeroLayout = 'split' | 'split-reverse' | 'centered' | 'band';

/**
 * Rozstaw sekcji pod hero. Dodatek sekcji (mapa biur, siatka miesiąca, opis formularza z krokami)
 * stoi obok treści po lewej (`start`) albo po prawej (`end`); `stacked` = jedna wyśrodkowana kolumna.
 */
export type PublicSectionLayout = 'start' | 'end' | 'stacked';

export interface PublicTemplate {
  id: PublicTemplateId;
  label: string;
  description: string;
  /** Kolor przewodni, gdy poseł nie wybrał własnego. */
  defaultBrand: string;
  dark: boolean;
  palette: Record<PaletteVar, Hsl>;
  /** Nadpisania przy ustawieniu dostępności "Wysoki kontrast". */
  contrast: Partial<Record<PaletteVar, Hsl>>;
  fontBody: string;
  fontHeading: string;
  /** `--radius` (przyciski, pola) i zaokrąglenie kart. */
  radius: string;
  cardRadius: string;
  hero: PublicHeroLayout;
  sections: Record<HomepageSectionId, PublicSectionLayout>;
}

const POPPINS = "'Poppins', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const INTER = "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const SERIF = "'Source Serif 4', Georgia, 'Times New Roman', serif";

export const PUBLIC_TEMPLATES: Record<PublicTemplateId, PublicTemplate> = {
  klasyczny: {
    id: 'klasyczny',
    label: 'Klasyczny',
    description: 'Ciepły krem i grafit. Zdjęcie po prawej, mapa i kalendarz po lewej stronie sekcji.',
    defaultBrand: '#c8102e',
    dark: false,
    palette: {
      cream: '39 39% 93%',
      'cream-2': '39 36% 89%',
      background: '39 39% 93%',
      foreground: '218 10% 15%',
      card: '0 0% 100%',
      muted: '39 36% 89%',
      'muted-foreground': '27 5% 40%',
      primary: '218 10% 15%',
      'primary-foreground': '0 0% 100%',
      'primary-end': '218 10% 10%',
      destructive: '350 85% 35%',
      border: '38 28% 84%',
      input: '38 28% 84%',
    },
    contrast: {
      foreground: '218 15% 7%',
      'muted-foreground': '27 10% 22%',
      primary: '218 15% 7%',
      'primary-end': '218 15% 3%',
      border: '38 14% 48%',
      input: '38 14% 40%',
    },
    fontBody: POPPINS,
    fontHeading: POPPINS,
    radius: '0.375rem',
    cardRadius: '12px',
    hero: 'split',
    sections: { offices: 'start', calendar: 'start', submit: 'start' },
  },
  nowoczesny: {
    id: 'nowoczesny',
    label: 'Nowoczesny',
    description: 'Chłodna biel, mocno zaokrąglone karty. Zdjęcie po lewej, układ sekcji w lustrzanym odbiciu.',
    defaultBrand: '#2563eb',
    dark: false,
    palette: {
      cream: '220 20% 97%',
      'cream-2': '220 16% 93%',
      background: '220 20% 97%',
      foreground: '222 30% 12%',
      card: '0 0% 100%',
      muted: '220 16% 93%',
      'muted-foreground': '220 9% 40%',
      primary: '222 40% 14%',
      'primary-foreground': '0 0% 100%',
      'primary-end': '222 40% 9%',
      destructive: '0 72% 42%',
      border: '220 14% 88%',
      input: '220 14% 85%',
    },
    contrast: {
      foreground: '222 40% 6%',
      'muted-foreground': '220 15% 22%',
      primary: '222 45% 8%',
      'primary-end': '222 45% 4%',
      border: '220 10% 50%',
      input: '220 12% 40%',
    },
    fontBody: INTER,
    fontHeading: INTER,
    radius: '0.75rem',
    cardRadius: '18px',
    hero: 'split-reverse',
    sections: { offices: 'end', calendar: 'end', submit: 'end' },
  },
  elegancki: {
    id: 'elegancki',
    label: 'Elegancki',
    description: 'Szeryfowe nagłówki, kość słoniowa. Wyśrodkowany portret i sekcje w jednej kolumnie.',
    defaultBrand: '#8c1d40',
    dark: false,
    palette: {
      cream: '40 33% 97%',
      'cream-2': '40 22% 92%',
      background: '40 33% 97%',
      foreground: '30 8% 14%',
      card: '0 0% 100%',
      muted: '40 22% 92%',
      'muted-foreground': '30 6% 38%',
      primary: '222 25% 16%',
      'primary-foreground': '0 0% 100%',
      'primary-end': '222 25% 11%',
      destructive: '355 70% 38%',
      border: '38 18% 85%',
      input: '38 18% 82%',
    },
    contrast: {
      foreground: '30 10% 6%',
      'muted-foreground': '30 8% 22%',
      primary: '222 30% 8%',
      'primary-end': '222 30% 4%',
      border: '38 10% 48%',
      input: '38 10% 40%',
    },
    fontBody: INTER,
    fontHeading: SERIF,
    radius: '0.25rem',
    cardRadius: '6px',
    hero: 'centered',
    sections: { offices: 'stacked', calendar: 'stacked', submit: 'stacked' },
  },
  wyrazisty: {
    id: 'wyrazisty',
    label: 'Wyrazisty',
    description: 'Pierwszy ekran w kolorze przewodnim, wersaliki, ostre narożniki. Biura w pełnej szerokości.',
    defaultBrand: '#c2410c',
    dark: false,
    palette: {
      cream: '0 0% 96%',
      'cream-2': '0 0% 91%',
      background: '0 0% 96%',
      foreground: '0 0% 7%',
      card: '0 0% 100%',
      muted: '0 0% 91%',
      'muted-foreground': '0 0% 36%',
      primary: '0 0% 7%',
      'primary-foreground': '0 0% 100%',
      'primary-end': '0 0% 0%',
      destructive: '0 80% 40%',
      border: '0 0% 85%',
      input: '0 0% 78%',
    },
    contrast: {
      foreground: '0 0% 3%',
      'muted-foreground': '0 0% 20%',
      primary: '0 0% 3%',
      border: '0 0% 45%',
      input: '0 0% 38%',
    },
    fontBody: POPPINS,
    fontHeading: POPPINS,
    radius: '0rem',
    cardRadius: '0px',
    hero: 'band',
    sections: { offices: 'stacked', calendar: 'end', submit: 'start' },
  },
  ciemny: {
    id: 'ciemny',
    label: 'Ciemny',
    description: 'Grafitowe tło, jasny tekst i świecący akcent. Kalendarz w jednej kolumnie.',
    defaultBrand: '#f59e0b',
    dark: true,
    palette: {
      cream: '222 18% 9%',
      'cream-2': '222 14% 18%',
      background: '222 18% 9%',
      foreground: '210 20% 94%',
      card: '222 16% 13%',
      muted: '222 14% 18%',
      'muted-foreground': '215 12% 70%',
      primary: '222 24% 5%',
      'primary-foreground': '0 0% 100%',
      'primary-end': '222 24% 3%',
      destructive: '0 85% 68%',
      border: '222 12% 24%',
      input: '222 12% 32%',
    },
    contrast: {
      foreground: '0 0% 100%',
      'muted-foreground': '215 15% 86%',
      border: '222 10% 55%',
      input: '222 10% 62%',
      destructive: '0 90% 76%',
    },
    fontBody: INTER,
    fontHeading: INTER,
    radius: '0.5rem',
    cardRadius: '12px',
    hero: 'split',
    sections: { offices: 'end', calendar: 'stacked', submit: 'end' },
  },
};

export const PUBLIC_TEMPLATE_LIST: readonly PublicTemplate[] = Object.values(PUBLIC_TEMPLATES);

/** Propozycje koloru przewodniego w panelu (poza kolorem domyślnym szablonu). */
export const BRAND_COLOR_PRESETS: readonly { hex: string; label: string }[] = [
  { hex: '#c8102e', label: 'Czerwony' },
  { hex: '#8c1d40', label: 'Bordowy' },
  { hex: '#c2410c', label: 'Pomarańczowy' },
  { hex: '#1e3a8a', label: 'Granatowy' },
  { hex: '#2563eb', label: 'Niebieski' },
  { hex: '#0f766e', label: 'Morski' },
  { hex: '#15803d', label: 'Zielony' },
  { hex: '#6d28d9', label: 'Fioletowy' },
];

// ---- kolory ----

interface HslColor {
  h: number;
  s: number;
  l: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: [number, number, number]): HslColor {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hslToRgb({ h, s, l }: HslColor): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (ln - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

function parseHsl(value: Hsl): HslColor {
  const [h, s, l] = value.split(' ').map((part) => Number.parseFloat(part));
  return { h, s, l };
}

function formatHsl({ h, s, l }: HslColor): Hsl {
  const r = (n: number) => Math.round(n * 10) / 10;
  return `${r(h)} ${r(s)}% ${r(l)}%`;
}

function toHex(color: HslColor): string {
  return `#${hslToRgb(color)
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Luminancja względna WCAG 2.x. */
function luminance(color: HslColor): number {
  const [r, g, b] = hslToRgb(color).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: HslColor, b: HslColor): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: HslColor = { h: 0, s: 0, l: 100 };
const INK: HslColor = { h: 222, s: 24, l: 8 };

/**
 * Jasność koloru przesunięta (ciemniej na jasnych tłach, jaśniej na ciemnych) do pierwszej
 * wartości z kontrastem >= `minRatio` wobec każdej z powierzchni. Odcień i nasycenie zostają.
 */
function fitToSurfaces(color: HslColor, surfaces: HslColor[], minRatio: number, darkSurfaces: boolean): HslColor {
  const worst = (c: HslColor) => Math.min(...surfaces.map((s) => contrastRatio(c, s)));
  const step = darkSurfaces ? 0.5 : -0.5;
  let fitted = color;
  while (worst(fitted) < minRatio && fitted.l > 0 && fitted.l < 100) {
    fitted = { ...fitted, l: Math.min(100, Math.max(0, fitted.l + step)) };
  }
  return fitted;
}

export interface ResolvedBrand {
  /** Kolor wybrany w panelu albo domyślny szablonu. */
  chosenHex: string;
  /** Kolor użyty na stronie (po dociągnięciu kontrastu). */
  usedHex: string;
  adjusted: boolean;
  /** Kolor tekstu na kolorze przewodnim (biały albo atrament). */
  foregroundHex: string;
  brand: HslColor;
  brandEnd: HslColor;
  foreground: HslColor;
  foregroundEnd: HslColor;
}

/** Kolor przewodni dla szablonu: kontrast tekstu z tłem i kartą (AA 4.5:1, wysoki kontrast 7:1). */
export function resolveBrand(template: PublicTemplate, brandColor: string, highContrast: boolean): ResolvedBrand {
  const chosenHex = (HEX_COLOR.test(brandColor) ? brandColor : template.defaultBrand).toLowerCase();
  const palette = { ...template.palette, ...(highContrast ? template.contrast : {}) };
  const surfaces = [parseHsl(palette.background), parseHsl(palette.card)];
  const brand = fitToSurfaces(rgbToHsl(hexToRgb(chosenHex)), surfaces, highContrast ? 7 : 4.5, template.dark);
  // Tekst na kolorze przewodnim: biały albo atrament - co daje większy kontrast.
  const onWhite = contrastRatio(brand, WHITE) >= contrastRatio(brand, INK);
  const foreground = onWhite ? WHITE : INK;
  // Najechanie: dalej od koloru tekstu na przycisku (kontrast przycisku rośnie).
  const brandEnd = { ...brand, l: Math.min(100, Math.max(0, brand.l + (onWhite ? -8 : 8))) };
  const foregroundEnd = onWhite ? { h: 0, s: 0, l: 90 } : { h: 222, s: 18, l: 22 };
  const usedHex = toHex(brand);
  return {
    chosenHex,
    usedHex,
    adjusted: usedHex !== toHex(rgbToHsl(hexToRgb(chosenHex))),
    foregroundHex: toHex(foreground),
    brand,
    brandEnd,
    foreground,
    foregroundEnd,
  };
}

/** Kolor tekstu/ikony czytelny na danym kolorze (np. znacznik na próbce koloru w panelu). */
export function textColorOn(hex: string): string {
  const color = rgbToHsl(hexToRgb(hex));
  return contrastRatio(color, WHITE) >= contrastRatio(color, INK) ? toHex(WHITE) : toHex(INK);
}

/** Wszystkie zmienne CSS strony publicznej dla wyglądu - stały zestaw kluczy (ten sam w każdym szablonie). */
export function publicThemeVars(appearance: HomepageContent['appearance'], highContrast: boolean): Record<string, string> {
  const template = PUBLIC_TEMPLATES[appearance.template];
  const p = { ...template.palette, ...(highContrast ? template.contrast : {}) };
  const b = resolveBrand(template, appearance.brand_color, highContrast);
  const brand = formatHsl(b.brand);
  const brandFg = formatHsl(b.foreground);
  return {
    '--cream': p.cream,
    '--cream-2': p['cream-2'],
    '--background': p.background,
    '--foreground': p.foreground,
    '--card': p.card,
    '--card-foreground': p.foreground,
    '--popover': p.card,
    '--popover-foreground': p.foreground,
    '--primary': p.primary,
    '--primary-foreground': p['primary-foreground'],
    '--primary-end': p['primary-end'],
    '--secondary': p.muted,
    '--secondary-foreground': p.foreground,
    '--muted': p.muted,
    '--muted-foreground': p['muted-foreground'],
    '--accent': p.muted,
    '--accent-foreground': p.foreground,
    '--destructive': p.destructive,
    '--destructive-foreground': template.dark ? formatHsl(INK) : '0 0% 100%',
    '--border': p.border,
    '--input': p.input,
    '--brand': brand,
    '--brand-foreground': brandFg,
    '--brand-end': formatHsl(b.brandEnd),
    '--ring': brand,
    // Surowe wartości dla odwróconych obszarów (hero w kolorze przewodnim, `.public-brand-surface`).
    '--public-brand': brand,
    '--public-brand-fg': brandFg,
    '--public-brand-fg-end': formatHsl(b.foregroundEnd),
    '--radius': template.radius,
    '--public-radius-card': template.cardRadius,
    '--public-font-body': template.fontBody,
    '--public-font-heading': template.fontHeading,
    'color-scheme': template.dark ? 'dark' : 'light',
  };
}

// ---- pamięć ostatniego wyglądu (bez mignięcia domyślnego szablonu przed odpowiedzią RPC) ----

const APPEARANCE_CACHE_KEY = 'app:public-appearance';

export function readCachedAppearance(): HomepageContent['appearance'] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(APPEARANCE_CACHE_KEY) ?? 'null') as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const { template, brand_color } = raw as Record<string, unknown>;
    if (typeof template !== 'string' || !Object.prototype.hasOwnProperty.call(PUBLIC_TEMPLATES, template)) return null;
    return {
      template: template as PublicTemplateId,
      brand_color: typeof brand_color === 'string' && HEX_COLOR.test(brand_color) ? brand_color : '',
    };
  } catch {
    return null;
  }
}

export function cacheAppearance(appearance: HomepageContent['appearance']): void {
  try {
    localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(appearance));
  } catch {
    // localStorage niedostępny - przy następnej wizycie krótko widać szablon domyślny
  }
}

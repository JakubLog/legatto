import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';
import animate from 'tailwindcss-animate';
import containerQueries from '@tailwindcss/container-queries';
import plugin from 'tailwindcss/plugin';
import colors from 'tailwindcss/colors';

// Tryb „Kolory dla daltonistów” (Mój profil → Ustawienia dostępności, klasa `a11y-colorblind` na <html>):
// zieleń (stan „w porządku”: załatwione, w limicie, sukces) przechodzi w niebieski, który przy
// zaburzeniach czerwono-zielonych nie myli się z czerwienią, pomarańczem i bursztynem.
// Palety `emerald` i `green` idą przez zmienne CSS, więc działają też modyfikatory (`bg-emerald-500/10`).
const SWAPPABLE_PALETTES = { emerald: colors.emerald, green: colors.green } as const;
type SwappablePalette = keyof typeof SWAPPABLE_PALETTES;
const PALETTE_NAMES = Object.keys(SWAPPABLE_PALETTES) as SwappablePalette[];

function hexToRgbChannels(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

const swappableColors = Object.fromEntries(
  PALETTE_NAMES.map((name) => [
    name,
    Object.fromEntries(
      Object.keys(SWAPPABLE_PALETTES[name]).map((shade) => [shade, `rgb(var(--palette-${name}-${shade}) / <alpha-value>)`]),
    ),
  ]),
);

/** Zmienne `--palette-<nazwa>-<odcień>` (kanały RGB) z podanych palet. */
function paletteVars(source: (name: SwappablePalette) => Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    PALETTE_NAMES.flatMap((name) =>
      Object.entries(source(name)).map(([shade, hex]) => [`--palette-${name}-${shade}`, hexToRgbChannels(hex)]),
    ),
  );
}

// Progi kontenera = progi ekranu (sm/md/lg/xl/2xl), więc `@md:` w treści modułu działa jak `md:`,
// ale względem szerokości obszaru modułu (`<main>` w AppShell), a nie okna - np. przy otwartym PoliAI.
const CONTAINER_SIZES = { sm: '40rem', md: '48rem', lg: '64rem', xl: '80rem', '2xl': '96rem' };

const config: Config = {
  // `hover:` tylko na urządzeniach z prawdziwym hoverem - na dotyku tło nie "przykleja się" po tapnięciu.
  future: { hoverOnlyWhenSupported: true },
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1400px',
      },
    },
    containers: CONTAINER_SIZES,
    // `shadow-card` / `shadow-popover` are boxShadow tokens; drop the same-named colors from
    // shadow colors, otherwise Tailwind also emits `shadow-<color>` rules that recolor the shadow.
    boxShadowColor: ({ theme }) =>
      Object.fromEntries(
        Object.entries<string | Record<string, string>>(theme('colors')).filter(
          ([name]) => name !== 'card' && name !== 'popover',
        ),
      ),
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        ...swappableColors,
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        'primary-end': 'hsl(var(--primary-end))',
        brand: {
          DEFAULT: 'hsl(var(--brand))',
          foreground: 'hsl(var(--brand-foreground))',
        },
        'brand-end': 'hsl(var(--brand-end))',
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          border: 'hsl(var(--sidebar-border))',
          muted: 'hsl(var(--sidebar-muted))',
        },
        // Tylko strona publiczna: zmienne definiowane w `.theme-public` (src/index.css).
        cream: 'hsl(var(--cream))',
        'cream-2': 'hsl(var(--cream-2))',
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 4px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        card: '0 1px 2px 0 hsl(220 20% 20% / 0.04), 0 1px 3px 0 hsl(220 20% 20% / 0.06)',
        'card-hover': '0 2px 4px -1px hsl(220 20% 20% / 0.06), 0 6px 16px -4px hsl(220 20% 20% / 0.1)',
        popover: '0 4px 8px -2px hsl(220 20% 20% / 0.08), 0 12px 32px -8px hsl(220 20% 20% / 0.16)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        // PoliAI: przepływ gradientu znaku i kafelka startowego (tło 200% szerokości).
        'gradient-flow': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'gradient-flow': 'gradient-flow 6s ease-in-out infinite',
      },
    },
  },
  plugins: [
    animate,
    containerQueries,
    // `@max-md:` itd. - odpowiednik `max-md:` dla kontenera (plugin ma tylko warianty min-width).
    plugin(({ addVariant }) => {
      for (const [name, size] of Object.entries(CONTAINER_SIZES)) {
        addVariant(`@max-${name}`, `@container not (min-width: ${size})`);
      }
    }),
    plugin(({ addBase }) => {
      addBase({
        ':root': paletteVars((name) => SWAPPABLE_PALETTES[name]),
        'html.a11y-colorblind': paletteVars(() => colors.blue),
      });
    }),
  ],
};

export default config;

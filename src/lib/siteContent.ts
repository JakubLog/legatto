import { z } from 'zod';

// Treść publicznej strony instancji (jedna instancja = jeden poseł).
// Przechowywana w app_settings pod kluczami 'site_identity' i 'homepage' (JSONB),
// czytana publicznie przez RPC get_public_site_content(), zapisywana przez Posła/administratora (aal2).
// Domyślne wartości w kodzie i seed migracji są neutralne - dane konkretnego posła wpisuje panel admina
// albo jednorazowy skrypt danych instancji (scripts/instances/<poseł>/site-content.sql).

const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number, message: string) => z.string().trim().min(1, message).max(max);
// Adres zewnętrzny (https://...) albo ścieżka w obrębie strony (/...). Bez białych znaków i backslashy:
// przeglądarka zamienia "/\evil.com" i "/\t/evil.com" na adres innej domeny.
const ABSOLUTE_URL = /^https?:\/\/[^\s\\]+$/i;
const LOCAL_PATH = /^\/(?![/\\])[^\s\\]*$/;
const urlOrEmpty = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || ABSOLUTE_URL.test(v) || LOCAL_PATH.test(v), 'Podaj adres zaczynający się od https:// albo /');
const requiredUrl = z
  .string()
  .trim()
  .min(1, 'Podaj adres')
  .max(500)
  .refine((v) => ABSOLUTE_URL.test(v), 'Podaj adres zaczynający się od https://');

export const HOMEPAGE_SECTION_IDS = ['offices', 'calendar', 'submit'] as const;
export type HomepageSectionId = (typeof HOMEPAGE_SECTION_IDS)[number];

/** Kotwice sekcji na stronie głównej - stałe, bo linkują do nich nawigacja i przyciski. */
export const HOMEPAGE_SECTION_ANCHORS: Record<HomepageSectionId, string> = {
  offices: 'biura',
  calendar: 'kalendarz',
  submit: 'zglos',
};

/** Szablony wyglądu strony publicznej - definicje (paleta, fonty, układ hero) w src/lib/publicTheme.ts. */
export const PUBLIC_TEMPLATE_IDS = ['klasyczny', 'nowoczesny', 'elegancki', 'wyrazisty', 'ciemny'] as const;
export type PublicTemplateId = (typeof PUBLIC_TEMPLATE_IDS)[number];

/** Kolor przewodni "#rrggbb"; pusty = domyślny kolor szablonu. */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const siteIdentitySchema = z.object({
  /** "Jan Kowalski" */
  mp_name: requiredText(120, 'Wpisz imię i nazwisko posła'),
  /** Dopełniacz: "Jana Kowalskiego" (Biuro Poselskie ..., zgody RODO). */
  mp_name_genitive: requiredText(140, 'Wpisz imię i nazwisko w dopełniaczu'),
  /** "Poseł na Sejm RP" / "Posłanka na Sejm RP" */
  mp_title: requiredText(80, 'Wpisz tytuł'),
  /** Rodzaj gramatyczny form "Poseł"/"Posłanka" w całym systemie (src/lib/mpForms.ts, api/_lib/siteIdentity.ts). */
  mp_gender: z.enum(['m', 'f']),
  /** "Okręg wyborczy nr 35 - Olsztyn"; nadtytuł hero, gdy pusty `hero.kicker`, i tytuł mapy. */
  district_label: text(120),
  /** Strona posła - link w stopce (Kontakt); pusty = brak linku. */
  website_url: urlOrEmpty,
  /** Zdjęcie posła (wycięte, przezroczyste tło); pusty = hero bez zdjęcia. */
  photo_url: urlOrEmpty,
});
export type SiteIdentity = z.infer<typeof siteIdentitySchema>;

const linkSchema = z.object({
  label: requiredText(40, 'Wpisz etykietę'),
  href: requiredUrl,
});

const stepSchema = z.object({
  title: requiredText(80, 'Wpisz tytuł kroku'),
  text: text(240),
});

export const homepageSchema = z.object({
  /** Wygląd strony: szablon i kolor przewodni (przyciski, akcenty, wyróżnienia). */
  appearance: z.object({
    template: z.enum(PUBLIC_TEMPLATE_IDS),
    brand_color: z
      .string()
      .trim()
      .refine((v) => v === '' || HEX_COLOR.test(v), 'Podaj kolor w formacie #RRGGBB'),
  }),
  seo: z.object({
    /** <title> strony publicznej. */
    title: requiredText(120, 'Wpisz tytuł strony'),
    description: text(300),
  }),
  /** Belka promocyjna nad nagłówkiem. */
  promo: z.object({
    enabled: z.boolean(),
    label: text(40),
    name: text(80),
    text: text(240),
    cta: text(60),
    href: urlOrEmpty,
  }),
  /** Dodatkowe linki zewnętrzne w nawigacji (np. "O Pośle"). */
  external_links: z.array(linkSchema).max(4),
  hero: z.object({
    kicker: text(120),
    lead: text(400),
    primary_cta: requiredText(40, 'Wpisz tekst przycisku'),
    secondary_cta: requiredText(40, 'Wpisz tekst przycisku'),
  }),
  /** Kolejność i widoczność sekcji; każda sekcja występuje dokładnie raz. */
  sections: z
    .array(z.object({ id: z.enum(HOMEPAGE_SECTION_IDS), enabled: z.boolean() }))
    .length(HOMEPAGE_SECTION_IDS.length)
    .refine((list) => new Set(list.map((s) => s.id)).size === list.length, 'Sekcje nie mogą się powtarzać'),
  offices: z.object({
    nav_label: requiredText(40, 'Wpisz etykietę menu'),
    title: requiredText(80, 'Wpisz tytuł sekcji'),
    /** Mapa okręgu (dziś tylko geojson okręgu 35) - wyłączana niezależnie od listy biur. */
    show_map: z.boolean(),
    map_caption: text(160),
    empty_text: text(160),
  }),
  calendar: z.object({
    nav_label: requiredText(40, 'Wpisz etykietę menu'),
    title: requiredText(80, 'Wpisz tytuł sekcji'),
    description: text(240),
  }),
  submit: z.object({
    nav_label: requiredText(40, 'Wpisz etykietę menu'),
    title: requiredText(80, 'Wpisz tytuł sekcji'),
    description: text(240),
    steps: z.array(stepSchema).max(6),
  }),
  footer: z.object({
    tagline: text(300),
    /** Tekst po "© {rok} ". */
    copyright: text(200),
  }),
});
export type HomepageContent = z.infer<typeof homepageSchema>;

export interface SiteContent {
  identity: SiteIdentity;
  homepage: HomepageContent;
}

export const DEFAULT_SITE_IDENTITY: SiteIdentity = {
  mp_name: '',
  mp_name_genitive: '',
  mp_title: 'Poseł na Sejm RP',
  mp_gender: 'm',
  district_label: '',
  website_url: '',
  photo_url: '',
};

export const DEFAULT_HOMEPAGE: HomepageContent = {
  appearance: { template: 'klasyczny', brand_color: '' },
  seo: { title: 'Biuro Poselskie', description: '' },
  promo: { enabled: false, label: 'Nasz projekt:', name: '', text: '', cta: '', href: '' },
  external_links: [],
  hero: {
    kicker: '',
    lead: 'Sprawy wyborców, spotkania w terenie, interwencje u urzędów.',
    primary_cta: 'Zgłoś sprawę',
    secondary_cta: 'Znajdź biuro',
  },
  sections: HOMEPAGE_SECTION_IDS.map((id) => ({ id, enabled: true })),
  offices: {
    nav_label: 'Nasze biura',
    title: 'Nasze biura',
    show_map: false,
    map_caption: '',
    empty_text: 'Lista biur pojawi się wkrótce.',
  },
  calendar: { nav_label: 'Kalendarz', title: 'Kalendarz', description: '' },
  submit: {
    nav_label: 'Zgłoś sprawę',
    title: 'Masz sprawę? Napisz do nas.',
    description: 'Formularz trafia prosto do biura.',
    steps: [
      { title: 'Opisz sprawę', text: 'Co się stało, gdzie i jakiej pomocy potrzebujesz.' },
      { title: 'Biuro ją sprawdza', text: 'Ustalamy, kto może pomóc i gdzie trzeba interweniować.' },
      { title: 'Odezwiemy się', text: 'E-mailem lub telefonicznie, na dane podane w formularzu.' },
    ],
  },
  footer: {
    tagline: 'Sprawy mieszkańców, kalendarz spotkań i adresy biur w jednym miejscu.',
    copyright: 'Biuro Poselskie',
  },
};

export const DEFAULT_SITE_CONTENT: SiteContent = {
  identity: DEFAULT_SITE_IDENTITY,
  homepage: DEFAULT_HOMEPAGE,
};

const looseObjectSchema = z.record(z.string(), z.unknown()).catch({});
const storedSiteContentSchema = z
  .object({ identity: looseObjectSchema, homepage: looseObjectSchema })
  .catch({ identity: {}, homepage: {} });
const storedSectionsSchema = z
  .array(z.object({ id: z.enum(HOMEPAGE_SECTION_IDS), enabled: z.boolean().catch(true) }).nullable().catch(null))
  .catch([]);

/** Każda sekcja dokładnie raz, w zapisanej kolejności; brakujące dopisane na końcu jako widoczne. */
function normalizeSections(raw: unknown): HomepageContent['sections'] {
  const seen = new Set<HomepageSectionId>();
  const out: HomepageContent['sections'] = [];
  for (const item of storedSectionsSchema.parse(raw)) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  for (const id of HOMEPAGE_SECTION_IDS) if (!seen.has(id)) out.push({ id, enabled: true });
  return out;
}

/** Lista: odrzuca tylko złe elementy i przycina do limitu schematu (nie-tablica przechodzi dalej i spada do domyślnej). */
function filterList(schema: z.ZodArray<z.core.$ZodType>, raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  const items = raw.filter((item) => z.safeParse(schema.element, item).success);
  // zod 4: limit `.max(n)` tablicy siedzi w def.checks (bag.maximum zostaje puste).
  const max = schema._zod.def.checks
    ?.map((check) => check._zod.def)
    .find((def): def is z.core.$ZodCheckMaxLengthDef => def.check === 'max_length')?.maximum;
  return max === undefined ? items : items.slice(0, max);
}

function parseValue<T extends z.core.$ZodType>(schema: T, raw: unknown, fallback: z.infer<T>): z.infer<T> {
  const parsed = z.safeParse(schema, schema instanceof z.ZodArray ? filterList(schema, raw) : raw);
  return parsed.success ? parsed.data : fallback;
}

/** Pola grupy walidowane pojedynczo: złe albo brakujące pole dostaje wartość domyślną, reszta zostaje. */
function parseFields<T extends z.ZodObject>(schema: T, raw: unknown, fallback: z.infer<T>): z.infer<T> {
  const stored = looseObjectSchema.parse(raw);
  const out: Record<string, unknown> = { ...fallback };
  for (const [key, field] of Object.entries(schema.shape)) {
    if (key in stored) out[key] = parseValue(field, stored[key], out[key]);
  }
  return out as z.infer<T>;
}

/**
 * Odporny odczyt z bazy: każde pole walidowane osobno (listy - każdy element), więc jedna zła
 * wartość spada do domyślnej zamiast unieważniać całą grupę albo stronę.
 */
export function parseSiteContent(raw: unknown): SiteContent {
  const stored = storedSiteContentSchema.parse(raw);
  const h = stored.homepage;
  const shape = homepageSchema.shape;
  return {
    identity: parseFields(siteIdentitySchema, stored.identity, DEFAULT_SITE_IDENTITY),
    homepage: {
      appearance: parseFields(shape.appearance, h.appearance, DEFAULT_HOMEPAGE.appearance),
      seo: parseFields(shape.seo, h.seo, DEFAULT_HOMEPAGE.seo),
      promo: parseFields(shape.promo, h.promo, DEFAULT_HOMEPAGE.promo),
      external_links: parseValue(shape.external_links, h.external_links, DEFAULT_HOMEPAGE.external_links),
      hero: parseFields(shape.hero, h.hero, DEFAULT_HOMEPAGE.hero),
      sections: normalizeSections(h.sections),
      offices: parseFields(shape.offices, h.offices, DEFAULT_HOMEPAGE.offices),
      calendar: parseFields(shape.calendar, h.calendar, DEFAULT_HOMEPAGE.calendar),
      submit: parseFields(shape.submit, h.submit, DEFAULT_HOMEPAGE.submit),
      footer: parseFields(shape.footer, h.footer, DEFAULT_HOMEPAGE.footer),
    },
  };
}

/** "Biuro Poselskie Jana Kowalskiego" - albo samo "Biuro Poselskie" bez danych posła. */
export function officeFullName(identity: SiteIdentity): string {
  return identity.mp_name_genitive ? `Biuro Poselskie ${identity.mp_name_genitive}` : 'Biuro Poselskie';
}

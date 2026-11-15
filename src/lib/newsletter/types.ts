import { z } from 'zod';

// ============================================================================
// Schema newslettera - sekcje z .claude/attachements/newsletter-szablon.html
//
// Stale sekcje renderowane zawsze: HEADER (na gorze), FOOTER (na dole).
// Sekcje wymienne (SECTION_KEYS) sa dodawane przez osobe budujaca newsletter:
// `sections` to lista aktywnych sekcji w kolejnosci renderowania. Kazda sekcja
// moze wystapic co najwyzej raz. Tresc sekcji usunietej z `sections` zostaje
// w formularzu (mozna ja przywrocic), ale nie trafia do maila ani walidacji.
// ============================================================================

export const SECTION_KEYS = [
  'lead',
  'sejm',
  'commentary',
  'region_news',
  'expert',
  'number_of_week',
  'media',
  'reel',
  'events',
  'reader_question',
  'fact_check',
  'gallery',
  'quote',
  'recommend',
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === '' || /^https?:\/\//i.test(v), 'Wymagany pełny URL (https://...)')
  .optional()
  .or(z.literal(''));

const requiredUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => /^https?:\/\//i.test(v), 'Wymagany pełny URL (https://...)');

// ============================================================================
// Sekcje stale
// ============================================================================

export const headerSchema = z.object({
  avatar_url: optionalUrl.default(''),
  // prefault (nie default): w zod 4 default omija walidację, a brak wymaganego pola ma dawać błąd.
  date_label: z.string().trim().min(1, 'Wpisz datę').max(60).prefault(''),
  greeting_first_token: z.string().trim().max(40).default('[[firstname]]'),
  /** Region w naglowku ("Poseł na Sejm RP · <region>") i etykieta sekcji regionalnej; pusty = "Z regionu". */
  region_label: z.string().trim().max(60).default(''),
});

export const footerSchema = z.object({
  office_name: z.string().trim().min(1, 'Wpisz nazwę biura').max(150).prefault(''),
  office_address: z.string().trim().max(200).default(''),
  contact_email: z.string().email('Niepoprawny email').prefault(''),
  social_x: optionalUrl.default(''),
  social_facebook: optionalUrl.default(''),
  social_instagram: optionalUrl.default(''),
  social_tiktok: optionalUrl.default(''),
  social_youtube: optionalUrl.default(''),
  privacy_url: requiredUrl.prefault(''),
});

// ============================================================================
// Lead / Temat tygodnia
// ============================================================================

export const leadSchema = z.object({
  image_url: optionalUrl.default(''),
  link_url: optionalUrl.default(''),
  title: z.string().trim().max(200).default(''),
  description: z.string().trim().max(800).default(''),
  cta_label: z.string().trim().max(60).default('Czytaj więcej'),
});

// ============================================================================
// Co w Sejmie? (glosowania + wykres)
// ============================================================================

export const sejmClubSchema = z.object({
  name: z.string().trim().max(40).default(''),
  za: z.coerce.number().int().min(0).max(999).default(0),
  przeciw: z.coerce.number().int().min(0).max(999).default(0),
  wstrzymal: z.coerce.number().int().min(0).max(999).default(0),
  nieobecny: z.coerce.number().int().min(0).max(999).default(0),
});

export const sejmSchema = z.object({
  title: z.string().trim().max(200).default(''),
  sitting_label: z.string().trim().max(150).default(''),
  vote_link: optionalUrl.default(''),
  all_votes_link: optionalUrl.default(''),
  clubs: z.array(sejmClubSchema).max(12).default([]),
  comment: z.string().trim().max(1500).default(''),
});

// ============================================================================
// Komentarz polityczny
// ============================================================================

export const commentarySchema = z.object({
  title: z.string().trim().max(200).default(''),
  highlight: z.string().trim().max(500).default(''),
  body: z.string().trim().max(2500).default(''),
});

// ============================================================================
// Z regionu (etykieta: header.region_label)
// ============================================================================

export const regionNewsSchema = z.object({
  title: z.string().trim().max(200).default(''),
  image_url: optionalUrl.default(''),
  body: z.string().trim().max(2000).default(''),
});

// ============================================================================
// Okiem eksperta
// ============================================================================

export const expertSchema = z.object({
  title: z.string().trim().max(200).default(''),
  tag1: z.string().trim().max(40).default(''),
  tag2: z.string().trim().max(40).default(''),
  body: z.string().trim().max(2500).default(''),
  link_url: optionalUrl.default(''),
  link_label: z.string().trim().max(60).default('Przeczytaj pełną analizę'),
});

// ============================================================================
// Liczba tygodnia
// ============================================================================

export const numberSchema = z.object({
  value: z.string().trim().max(40).default(''),
  context: z.string().trim().max(400).default(''),
});

// ============================================================================
// W mediach
// ============================================================================

export const mediaItemSchema = z.object({
  image_url: optionalUrl.default(''),
  title: z.string().trim().max(200).default(''),
  link_url: optionalUrl.default(''),
  outlet_date: z.string().trim().max(120).default(''),
});

export const mediaSchema = z.object({
  items: z.array(mediaItemSchema).max(10).default([]),
});

// ============================================================================
// Rolka tygodnia
// ============================================================================

export const reelSchema = z.object({
  image_url: optionalUrl.default(''),
  title: z.string().trim().max(200).default(''),
  instagram_url: optionalUrl.default(''),
  tiktok_url: optionalUrl.default(''),
});

// ============================================================================
// Zapraszam (wydarzenia)
// ============================================================================

export const eventItemSchema = z.object({
  day: z.string().trim().max(4).default(''),
  month: z.string().trim().max(8).default(''),
  title: z.string().trim().max(200).default(''),
  location: z.string().trim().max(200).default(''),
  detail: z.string().trim().max(200).default(''),
});

export const eventsSchema = z.object({
  items: z.array(eventItemSchema).max(10).default([]),
});

// ============================================================================
// Pytanie do czytelnikow
// ============================================================================

export const readerOptionSchema = z.object({
  label: z.string().trim().max(60).default(''),
  link_url: optionalUrl.default(''),
});

export const readerQuestionSchema = z.object({
  question: z.string().trim().max(300).default(''),
  options: z.array(readerOptionSchema).max(4).default([]),
});

// ============================================================================
// Fact-check
// ============================================================================

export const FACT_CHECK_VERDICTS = ['manipulacja', 'czesciowa', 'prawda', 'falsz'] as const;
export type FactCheckVerdict = (typeof FACT_CHECK_VERDICTS)[number];

export const factCheckSchema = z.object({
  statement: z.string().trim().max(500).default(''),
  statement_source: z.string().trim().max(200).default(''),
  verdict: z.enum(FACT_CHECK_VERDICTS).default('manipulacja'),
  explanation: z.string().trim().max(2000).default(''),
  source_link: optionalUrl.default(''),
});

// ============================================================================
// Galeria
// ============================================================================

export const galleryImageSchema = z.object({
  url: optionalUrl.default(''),
});

export const gallerySchema = z.object({
  label: z.string().trim().max(60).default('Z tego tygodnia'),
  images: z.array(galleryImageSchema).max(8).default([]),
});

// ============================================================================
// Cytat tygodnia
// ============================================================================

export const quoteSchema = z.object({
  body: z.string().trim().max(500).default(''),
  author: z.string().trim().max(100).default(''),
});

// ============================================================================
// Polecam
// ============================================================================

export const recommendItemSchema = z.object({
  image_url: optionalUrl.default(''),
  kind: z.string().trim().max(60).default(''),
  title: z.string().trim().max(200).default(''),
  link_url: optionalUrl.default(''),
  description: z.string().trim().max(400).default(''),
});

export const recommendSchema = z.object({
  items: z.array(recommendItemSchema).max(6).default([]),
});

// ============================================================================
// Pelny szablon
// ============================================================================

const blank = (v: string | undefined) => !v || !v.trim();

/**
 * Minimalna tresc wymagana od kazdej aktywnej sekcji - bez niej sekcja wyszlaby pusta.
 * Bledy przypiete do konkretnych pol, zeby edytor pokazal je przy polu i w naglowku sekcji.
 */
type TemplateShape = z.infer<typeof templateObjectSchema>;
type Issue = { path: (string | number)[]; message: string };

const REQUIRED_CONTENT: Record<SectionKey, (t: TemplateShape) => Issue[]> = {
  lead: (t) => [
    ...(blank(t.lead.title) ? [{ path: ['lead', 'title'], message: 'Wpisz tytuł tematu' }] : []),
    ...(blank(t.lead.description) ? [{ path: ['lead', 'description'], message: 'Wpisz opis tematu' }] : []),
  ],
  sejm: (t) =>
    blank(t.sejm.title) ? [{ path: ['sejm', 'title'], message: 'Wpisz tytuł głosowania' }] : [],
  commentary: (t) =>
    blank(t.commentary.body) ? [{ path: ['commentary', 'body'], message: 'Wpisz treść komentarza' }] : [],
  region_news: (t) =>
    blank(t.region_news.title) ? [{ path: ['region_news', 'title'], message: 'Wpisz tytuł newsa' }] : [],
  expert: (t) =>
    blank(t.expert.body) ? [{ path: ['expert', 'body'], message: 'Wpisz treść analizy' }] : [],
  number_of_week: (t) =>
    blank(t.number_of_week.value) ? [{ path: ['number_of_week', 'value'], message: 'Wpisz liczbę' }] : [],
  media: (t) =>
    t.media.items.some((i) => !blank(i.title))
      ? []
      : [{ path: ['media', 'items', 0, 'title'], message: 'Dodaj co najmniej jedno wystąpienie z tytułem' }],
  reel: (t) =>
    blank(t.reel.instagram_url) && blank(t.reel.tiktok_url)
      ? [{ path: ['reel', 'instagram_url'], message: 'Podaj link do Instagrama lub TikToka' }]
      : [],
  events: (t) =>
    t.events.items.some((i) => !blank(i.title))
      ? []
      : [{ path: ['events', 'items', 0, 'title'], message: 'Dodaj co najmniej jedno wydarzenie' }],
  reader_question: (t) =>
    blank(t.reader_question.question)
      ? [{ path: ['reader_question', 'question'], message: 'Wpisz pytanie' }]
      : [],
  fact_check: (t) => [
    ...(blank(t.fact_check.statement)
      ? [{ path: ['fact_check', 'statement'], message: 'Wpisz sprawdzane stwierdzenie' }]
      : []),
    ...(blank(t.fact_check.explanation)
      ? [{ path: ['fact_check', 'explanation'], message: 'Wpisz wyjaśnienie' }]
      : []),
  ],
  gallery: (t) =>
    t.gallery.images.some((i) => !blank(i.url))
      ? []
      : [{ path: ['gallery', 'images', 0, 'url'], message: 'Dodaj co najmniej jedno zdjęcie' }],
  quote: (t) => (blank(t.quote.body) ? [{ path: ['quote', 'body'], message: 'Wpisz cytat' }] : []),
  recommend: (t) =>
    t.recommend.items.some((i) => !blank(i.title))
      ? []
      : [{ path: ['recommend', 'items', 0, 'title'], message: 'Dodaj co najmniej jedną rekomendację' }],
};

const templateObjectSchema = z.object({
  subject: z.string().trim().min(3, 'Temat min. 3 znaki').max(150),
  preheader: z.string().trim().max(150).default(''),
  /** Nazwa w panelu GetResponse; pusta = generowana z daty i tematu (campaignNameFor). */
  campaign_name: z.string().trim().max(128).default(''),
  sections: z
    .array(z.enum(SECTION_KEYS))
    .max(SECTION_KEYS.length)
    .refine((s) => new Set(s).size === s.length, 'Sekcja może wystąpić tylko raz'),
  header: headerSchema,
  lead: leadSchema,
  sejm: sejmSchema,
  commentary: commentarySchema,
  region_news: regionNewsSchema,
  expert: expertSchema,
  number_of_week: numberSchema,
  media: mediaSchema,
  reel: reelSchema,
  events: eventsSchema,
  reader_question: readerQuestionSchema,
  fact_check: factCheckSchema,
  gallery: gallerySchema,
  quote: quoteSchema,
  recommend: recommendSchema,
  footer: footerSchema,
});

export const newsletterTemplateSchema = templateObjectSchema.superRefine((t, ctx) => {
  if (t.sections.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sections'], message: 'Dodaj co najmniej jedną sekcję' });
  }
  for (const key of t.sections) {
    for (const issue of REQUIRED_CONTENT[key](t)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, ...issue });
    }
  }
});

export type NewsletterTemplate = z.infer<typeof templateObjectSchema>;
export type HeaderSection = z.infer<typeof headerSchema>;
export type FooterSection = z.infer<typeof footerSchema>;
export type LeadSection = z.infer<typeof leadSchema>;
export type SejmSection = z.infer<typeof sejmSchema>;
export type SejmClub = z.infer<typeof sejmClubSchema>;
export type CommentarySection = z.infer<typeof commentarySchema>;
export type RegionNewsSection = z.infer<typeof regionNewsSchema>;
export type ExpertSection = z.infer<typeof expertSchema>;
export type NumberSection = z.infer<typeof numberSchema>;
export type MediaSection = z.infer<typeof mediaSchema>;
export type MediaItem = z.infer<typeof mediaItemSchema>;
export type ReelSection = z.infer<typeof reelSchema>;
export type EventsSection = z.infer<typeof eventsSchema>;
export type EventItem = z.infer<typeof eventItemSchema>;
export type ReaderQuestionSection = z.infer<typeof readerQuestionSchema>;
export type ReaderOption = z.infer<typeof readerOptionSchema>;
export type FactCheckSection = z.infer<typeof factCheckSchema>;
export type GallerySection = z.infer<typeof gallerySchema>;
export type QuoteSection = z.infer<typeof quoteSchema>;
export type RecommendSection = z.infer<typeof recommendSchema>;
export type RecommendItem = z.infer<typeof recommendItemSchema>;

/** Nazwa kampanii w GetResponse: wpisana recznie albo "Newsletter <data> – <temat>". */
export function campaignNameFor(t: Pick<NewsletterTemplate, 'campaign_name' | 'subject' | 'header'>): string {
  const manual = t.campaign_name.trim();
  if (manual) return manual;
  const parts = [`Newsletter ${t.header.date_label.trim()}`.trim(), t.subject.trim()].filter(Boolean);
  return parts.join(' – ').slice(0, 128);
}

// ============================================================================
// Wartosci domyslne (uzywane w formularzu edytora)
// ============================================================================

export const DEFAULT_SECTIONS: SectionKey[] = ['lead'];

export const DEFAULT_TEMPLATE: NewsletterTemplate = {
  subject: '',
  preheader: '',
  campaign_name: '',
  sections: DEFAULT_SECTIONS,
  header: {
    avatar_url: '',
    date_label: new Date().toLocaleDateString('pl-PL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    greeting_first_token: '[[firstname]]',
    region_label: '',
  },
  lead: {
    image_url: '',
    link_url: '',
    title: '',
    description: '',
    cta_label: 'Czytaj więcej',
  },
  sejm: {
    title: '',
    sitting_label: '',
    vote_link: '',
    all_votes_link: 'https://www.sejm.gov.pl/Sejm10.nsf/agent.xsp?symbol=glosowania&NrKadencji=10',
    clubs: [],
    comment: '',
  },
  commentary: {
    title: '',
    highlight: '',
    body: '',
  },
  region_news: {
    title: '',
    image_url: '',
    body: '',
  },
  expert: {
    title: '',
    tag1: '',
    tag2: '',
    body: '',
    link_url: '',
    link_label: 'Przeczytaj pełną analizę',
  },
  number_of_week: {
    value: '',
    context: '',
  },
  media: {
    items: [{ image_url: '', title: '', link_url: '', outlet_date: '' }],
  },
  reel: {
    image_url: '',
    title: '',
    instagram_url: '',
    tiktok_url: '',
  },
  events: {
    items: [{ day: '', month: '', title: '', location: '', detail: '' }],
  },
  reader_question: {
    question: '',
    options: [
      { label: '👍 Tak', link_url: '' },
      { label: '👎 Nie', link_url: '' },
      { label: '🤔 Trudno powiedzieć', link_url: '' },
    ],
  },
  fact_check: {
    statement: '',
    statement_source: '',
    verdict: 'manipulacja',
    explanation: '',
    source_link: '',
  },
  gallery: {
    label: 'Z tego tygodnia',
    images: [{ url: '' }, { url: '' }],
  },
  quote: {
    body: '',
    author: '',
  },
  recommend: {
    items: [{ image_url: '', kind: '', title: '', link_url: '', description: '' }],
  },
  footer: {
    office_name: '',
    office_address: '',
    contact_email: '',
    social_x: '',
    social_facebook: '',
    social_instagram: '',
    social_tiktok: '',
    social_youtube: '',
    privacy_url: '',
  },
};

// Generator HTML newslettera na bazie .claude/attachements/newsletter-szablon.html
// (kolory + struktura wlasciciela).
//
// Kolejnosc renderowania:
//   HEADER (zawsze na gorze) -> sekcje z `t.sections` w kolejnosci listy -> FOOTER (zawsze na dole)
//
// `t.sections` to uporzadkowana lista aktywnych sekcji (kazda co najwyzej raz) - sekcji spoza
// listy nie renderujemy. Kazdy renderer sekcji zwraca wewnetrzny blok (tabele); jeden wrapper
// (`wrapBlock`) sklada `<tr><td>...</td></tr>` + szary separator. W trybie podgladu
// (`mode: 'preview'`) zewnetrzny `<tr>` kazdego bloku dostaje `data-section="<klucz>"`, a puste
// obrazki zastepuje szary placeholder SVG; w trybie maila brak atrybutow data-* i placeholderow.
// GR merge tagi ([[firstname]], [[remove]]) wstawiane na sztywno w mailu. Link "Wyswietl w przegladarce"
// prowadzi do wlasnej wersji online (`webUrl`, /n/<slug>); tryb 'web' renderuje te wersje - bez
// merge tagow GR (powitanie bez imienia, bez linku wypisu).
//
// Dane posla (imie i nazwisko, tytul, rodzaj) przychodza z `site_identity` przez `opts.identity`
// (naglowek, alt avatara, klauzula RODO); region (`header.region_label`) jest polem szablonu
// wypelnianym ze stalych newslettera. Bez nazwiska naglowek i RODO uzywaja nazwy biura ze stopki.

import type {
  CommentarySection,
  EventsSection,
  ExpertSection,
  FactCheckSection,
  FooterSection,
  GallerySection,
  HeaderSection,
  LeadSection,
  MediaSection,
  NewsletterTemplate,
  NumberSection,
  QuoteSection,
  ReaderQuestionSection,
  RecommendSection,
  ReelSection,
  RegionNewsSection,
  SectionKey,
  SejmClub,
  SejmSection,
} from './types';
import type { SiteIdentity } from '@/lib/siteContent';
import { mpForms } from '@/lib/mpForms';

/** Klucz bloku w podgladzie (atrybut `data-section`): stale header/footer + sekcje wymienne. */
export type PreviewBlockKey = 'header' | SectionKey | 'footer';

/**
 * - `email`   - HTML wysylany przez GetResponse,
 * - `preview` - podglad w edytorze (data-section, placeholdery obrazkow),
 * - `web`     - wersja online pod /n/<slug> (bez merge tagow GR).
 */
export type RenderMode = 'email' | 'preview' | 'web';

/** Dane posla potrzebne w mailu (`useSiteContent().data.identity`). */
export type NewsletterIdentity = Pick<SiteIdentity, 'mp_name' | 'mp_title' | 'mp_gender'>;

export interface RenderOptions {
  mode?: RenderMode;
  /** Adres wersji online - link "Wyswietl w przegladarce" w mailu. Bez niego pasek jest pomijany. */
  webUrl?: string;
  identity: NewsletterIdentity;
}

interface RenderCtx {
  preview: boolean;
  web: boolean;
  identity: NewsletterIdentity;
}

/** Etykieta sekcji regionalnej: region z naglowka albo neutralne "Z regionu". */
const regionLabel = (t: NewsletterTemplate): string => t.header.region_label.trim() || 'Z regionu';

/** Tytul posla; pusty w danych -> "Poseł/Posłanka na Sejm RP" wg rodzaju. */
const mpTitle = (identity: NewsletterIdentity): string =>
  identity.mp_title.trim() || `${mpForms(identity.mp_gender).nominative} na Sejm RP`;

/** Inicjaly do kolka bez zdjecia: "Jan Kowalski" -> "JK". */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');

// ============================================================================
// Helpers
// ============================================================================

const escapeHtml = (str: string): string =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeAttr = (str: string): string => escapeHtml(str);

// Allowlista schematow URL w atrybutach href/src - blokuje javascript:, data:, vbscript: itp.
// Pusty, wzgledny lub niedozwolony URL -> '' (wywolujacy pomija wtedy link / obrazek).
const SAFE_URL_SCHEMES: Record<string, true> = { 'http:': true, 'https:': true, 'mailto:': true, 'tel:': true };

function safeUrl(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  try {
    if (SAFE_URL_SCHEMES[new URL(value).protocol] === true) return escapeAttr(value);
  } catch {
    // niepoprawny / wzgledny URL
  }
  return '';
}

// Placeholder obrazka TYLKO dla podgladu w edytorze (staly SVG generowany tutaj, nigdy z danych
// uzytkownika) - pokazuje, gdzie wyladuje zdjecie. W mailu pusty obrazek jest pomijany.
function placeholderSrc(w: number, h: number, label: string): string {
  const fontSize = Math.max(10, Math.min(18, Math.round(Math.min(w, h) / 7)));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="#E8EAF0"/>` +
    `<text x="50%" y="50%" fill="#76829D" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="600" text-anchor="middle" dominant-baseline="middle">${escapeHtml(label)}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Bezpieczny src obrazka; pusty -> placeholder w podgladzie, '' w mailu. */
function imageSrc(raw: string | undefined, ctx: RenderCtx, w: number, h: number, label = 'Dodaj zdjęcie'): string {
  const url = safeUrl(raw);
  if (url || !ctx.preview) return url;
  return escapeAttr(placeholderSrc(w, h, label));
}

interface TextStyle {
  size?: number;
  lineHeight?: number;
  color?: string;
  /** Odstep 12px pod ostatnim akapitem (domyslnie tak). */
  trailingGap?: boolean;
  /** Gotowy (juz bezpieczny) HTML doklejany na koncu ostatniego akapitu. */
  suffixHtml?: string;
}

// Konwertuje plain text na HTML z paragrafami (rozdzielenie pustymi liniami)
const textToHtml = (
  text: string,
  { size = 15, lineHeight = 25, color = '#555D6B', trailingGap = true, suffixHtml = '' }: TextStyle = {},
): string => {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => escapeHtml(p).replace(/\n/g, '<br>'));
  if (suffixHtml) {
    if (paragraphs.length) paragraphs[paragraphs.length - 1] += suffixHtml;
    else paragraphs.push(suffixHtml.trim());
  }
  return paragraphs
    .map((p, idx) => {
      const margin = idx < paragraphs.length - 1 || trailingGap ? '0 0 12px 0' : '0';
      return `<p style="margin:${margin}; font-size:${size}px; color:${color}; line-height:${lineHeight}px;">${p}</p>`;
    })
    .join('');
};

// Separator miedzy sekcjami (jednolity w calym szablonie)
const SPACER = `\n<tr><td style="height:8px; background-color:#DCDDE1;"></td></tr>`;

const FONT_STACK = `'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

// Source Sans 3 (OFL, public/fonts/newsletter/OFL.txt) z originu instancji - bez zewnetrznych hostow
// fontow. Plik zmienny (wght 200-900) w dwoch podzbiorach; latin-ext niesie polskie znaki.
const FONT_PATH = '/fonts/newsletter';
const FONT_FACES: ReadonlyArray<{ file: string; range: string }> = [
  {
    file: 'source-sans-3-latin-ext-wght-normal.woff2',
    range:
      'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF',
  },
  {
    file: 'source-sans-3-latin-wght-normal.woff2',
    range:
      'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  },
];

/**
 * `@font-face` szablonu. Mail (i podglad, ktory go odwzorowuje) potrzebuje absolutnego URL-a originu
 * instancji - klient pocztowy nie zna bazy. Wersja online (/n/<slug>) jest serwowana z tego samego
 * originu, wiec sciezka wzgledna przetrwa zmiane domeny instancji. `@media screen` ukrywa reguly
 * przed Outlookiem (Word), ktory przy `@font-face` spada do Times New Roman zamiast FONT_STACK.
 */
function fontFaceCss(ctx: RenderCtx): string {
  const base = ctx.web ? FONT_PATH : `${window.location.origin}${FONT_PATH}`;
  const faces = FONT_FACES.map(
    ({ file, range }) =>
      `@font-face { font-family: 'Source Sans 3'; font-style: normal; font-weight: 200 900; font-display: swap; src: url('${base}/${file}') format('woff2'); unicode-range: ${range}; }`,
  );
  return `@media screen {\n      ${faces.join('\n      ')}\n    }`;
}

/** Jeden wrapper dla wszystkich blokow: komentarz + `<tr><td>` (+ data-section w podgladzie). */
function wrapBlock(key: PreviewBlockKey, comment: string, inner: string, ctx: RenderCtx): string {
  const attr = ctx.preview ? ` data-section="${key}"` : '';
  return `
<!-- ${comment} -->
<tr${attr}><td>${inner}
</td></tr>`;
}

// ============================================================================
// Sekcje stale
// ============================================================================

function renderHeader(h: HeaderSection, officeName: string, ctx: RenderCtx): string {
  const avatarUrl = safeUrl(h.avatar_url);
  const date = escapeHtml(h.date_label);
  // Domyslnie GR merge tag [[firstname]] - escape go nie zmienia, a blokuje wstrzykniecie HTML.
  const greeting = ctx.web ? 'Cześć!' : `Cześć, ${escapeHtml(h.greeting_first_token || '[[firstname]]')}!`;
  // Bez nazwiska posla w site_identity naglowek podpisuje biuro (nazwa ze stopki).
  const displayName = ctx.identity.mp_name.trim() || officeName.trim();
  const name = escapeHtml(displayName);
  const subtitle = [mpTitle(ctx.identity), h.region_label.trim()].filter(Boolean).map(escapeHtml).join('&nbsp;·&nbsp;');
  const avatar = avatarUrl
    ? `<img src="${avatarUrl}" alt="${name}" width="56" height="56" style="width:56px; height:56px; display:block; border-radius:50%; border:2px solid rgba(255,255,255,0.3); object-fit:cover; object-position:center;" />`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="56" height="56" align="center" valign="middle" bgcolor="#FF285C" style="width:56px; height:56px; border-radius:50%; background-color:#FF285C; border:2px solid rgba(255,255,255,0.3); color:#ffffff; font-size:20px; font-weight:800; line-height:56px; text-align:center; vertical-align:middle;">${escapeHtml(initials(displayName))}</td>
      </tr></table>`;
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#28367A" style="background-color:#28367A; background-image:linear-gradient(135deg, #1a2231 0%, #28367A 50%, #1a2231 100%); border-radius: 16px 16px 0 0; border-top: 4px solid #FF285C;">
<tr><td style="padding: 28px 32px 24px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr>
    <td style="vertical-align: middle; width: 60px;">
      ${avatar}
    </td>
    <td style="padding-left: 16px; vertical-align: middle;">
      <p style="margin:0; font-size:20px; font-weight:800; color:#ffffff; letter-spacing:-0.3px;">${name}</p>
      <p style="margin:4px 0 0 0; font-size:13px; font-weight:500; color:#A9AFBF;">${subtitle}</p>
      <p style="margin:6px 0 0 0; font-size:12px; font-weight:400; color:#D4D7DE;">${greeting}</p>
    </td>
    <td align="right" style="vertical-align: middle;" class="mobile-hide">
      <p style="margin:0; font-size:13px; color:#A9AFBF; font-weight:600;">📅 ${date}</p>
    </td>
  </tr>
  </table>
</td></tr>
</table>`;
}

// ============================================================================
// Lead / Temat tygodnia
// ============================================================================

function renderLead(s: LeadSection, ctx: RenderCtx): string {
  const title = escapeHtml(s.title);
  const img = imageSrc(s.image_url, ctx, 560, 320);
  const link = safeUrl(s.link_url);
  const description = textToHtml(s.description, { size: 16, lineHeight: 26, trailingGap: false });
  const cta = escapeHtml(s.cta_label.trim() || 'Czytaj więcej');
  const imgTag = img
    ? `<img src="${img}" alt="${title || 'Temat tygodnia'}" width="560" style="width:100%; display:block; border:0;" class="wrapper" />`
    : '';
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff;">
${
  imgTag
    ? `<tr><td style="padding:0;">
  ${link ? `<a href="${link}" style="text-decoration:none;">${imgTag}</a>` : imgTag}
</td></tr>`
    : ''
}
<tr><td style="padding: 28px 32px 8px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#28367A;">Temat tygodnia</p>
</td></tr>
${
  title
    ? `<tr><td style="padding: 8px 32px 12px 32px;" class="mobile-padding">
  <h1 class="hero-title" style="margin:0; font-size:28px; font-weight:800; color:#333E53; line-height:34px; letter-spacing:-0.5px;">
    ${title}
  </h1>
</td></tr>`
    : ''
}
${
  description
    ? `<tr><td style="padding: 4px 32px ${link ? '28px' : '32px'} 32px;" class="mobile-padding">
  ${description}
</td></tr>`
    : ''
}
${
  link
    ? `<tr><td style="padding: 0 32px 32px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr><td bgcolor="#FF285C" style="background-color:#FF285C; background-image:linear-gradient(135deg, #FF285C, #CC3366); border-radius:10px; padding: 14px 28px;">
    <a href="${link}" style="font-size:14px; font-weight:700; color:#ffffff; text-decoration:none; display:block;">
      ${cta} →
    </a>
  </td></tr>
  </table>
</td></tr>`
    : ''
}
</table>`;
}

// ============================================================================
// Co w Sejmie? (glosowania + wykres)
// ============================================================================

function renderVoteSegments(c: SejmClub): string {
  const total = c.za + c.przeciw + c.wstrzymal + c.nieobecny;
  if (total <= 0) return '';
  const segments = [
    { v: c.za, bg: '#22c55e', dark: false },
    { v: c.przeciw, bg: '#ef4444', dark: false },
    { v: c.wstrzymal, bg: '#FF285C', dark: false },
    { v: c.nieobecny, bg: '#d1d5db', dark: true },
  ];
  return segments
    .filter((x) => x.v > 0)
    .map((x) => {
      const w = Math.max(1, Math.round((x.v / total) * 100));
      const color = x.dark ? '#76829D' : '#fff';
      const fs = x.dark ? '10px' : '11px';
      const fw = x.dark ? '600' : '700';
      return `<td class="vote-bar" style="width:${w}%; height:28px; background:${x.bg}; font-size:${fs}; color:${color}; font-weight:${fw}; text-align:center; line-height:28px;">${x.v}</td>`;
    })
    .join('');
}

function renderSejm(s: SejmSection): string {
  const clubs = s.clubs.filter(
    (c) => c.name.trim() && c.za + c.przeciw + c.wstrzymal + c.nieobecny > 0,
  );
  const title = escapeHtml(s.title);
  const sitting = escapeHtml(s.sitting_label);
  const voteLink = safeUrl(s.vote_link);
  const allVotes = safeUrl(s.all_votes_link);
  const comment = textToHtml(s.comment, { size: 15, lineHeight: 24, color: '#333E53', trailingGap: false });

  const clubRows = clubs
    .map(
      (c) => `
  <tr><td style="padding: 6px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td width="100" style="font-size:13px; font-weight:700; color:#333E53; padding-right:8px;">${escapeHtml(c.name)}</td>
      <td>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-radius:4px; overflow:hidden; background:#E8EAF0;">
        <tr>${renderVoteSegments(c)}</tr>
        </table>
      </td>
    </tr>
    </table>
  </td></tr>`,
    )
    .join('');

  const legend = `
  <tr><td style="padding-bottom:12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="padding-right:16px;"><span style="display:inline-block;width:12px;height:12px;background:#22c55e;border-radius:3px;vertical-align:middle;"></span><span style="font-size:12px; color:#76829D; vertical-align:middle; padding-left:4px;">Za</span></td>
      <td style="padding-right:16px;"><span style="display:inline-block;width:12px;height:12px;background:#ef4444;border-radius:3px;vertical-align:middle;"></span><span style="font-size:12px; color:#76829D; vertical-align:middle; padding-left:4px;">Przeciw</span></td>
      <td style="padding-right:16px;"><span style="display:inline-block;width:12px;height:12px;background:#FF285C;border-radius:3px;vertical-align:middle;"></span><span style="font-size:12px; color:#76829D; vertical-align:middle; padding-left:4px;">Wstrzymał się</span></td>
      <td><span style="display:inline-block;width:12px;height:12px;background:#d1d5db;border-radius:3px;vertical-align:middle;"></span><span style="font-size:12px; color:#76829D; vertical-align:middle; padding-left:4px;">Nieobecny</span></td>
    </tr>
    </table>
  </td></tr>`;

  const chart = clubs.length
    ? `
<tr><td style="padding: 20px 32px 8px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  ${legend}
  ${clubRows}
  </table>
</td></tr>`
    : '';

  const commentBlock = comment
    ? `
<tr><td style="padding: 20px 32px 28px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0F2F8; border-radius:10px; border-left: 4px solid #28367A;">
  <tr><td style="padding: 16px 20px;">
    <p style="margin:0 0 6px 0; font-size:12px; font-weight:700; color:#28367A; text-transform:uppercase; letter-spacing:1px;">💬 Mój komentarz</p>
    ${comment}
  </td></tr>
  </table>
</td></tr>`
    : '';

  const metaLine = sitting || voteLink
    ? `
<tr><td style="padding: 4px 32px 4px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:13px; color:#76829D;">${sitting}${
    voteLink
      ? `${sitting ? ' · ' : ''}<a href="${voteLink}" style="color:#28367A; text-decoration:underline; font-weight:600;">szczegóły głosowania</a>`
      : ''
  }</p>
</td></tr>`
    : '';

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff; border-radius:12px;">
<tr><td style="padding: 28px 32px 8px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr>
    <td><p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#FF285C;">🏛️ Co w Sejmie?</p></td>
    ${allVotes ? `<td align="right"><a href="${allVotes}" style="font-size:12px; color:#76829D; text-decoration:none; font-weight:600;">Wszystkie głosowania →</a></td>` : ''}
  </tr>
  </table>
</td></tr>
${
  title
    ? `<tr><td style="padding: 12px 32px 4px 32px;" class="mobile-padding">
  <h2 class="section-title" style="margin:0; font-size:20px; font-weight:800; color:#333E53; line-height:26px;">${title}</h2>
</td></tr>`
    : ''
}
${metaLine}
${chart}
${commentBlock}
</table>`;
}

// ============================================================================
// Komentarz polityczny
// ============================================================================

function renderCommentary(s: CommentarySection): string {
  const title = escapeHtml(s.title);
  const highlight = escapeHtml(s.highlight);
  const body = textToHtml(s.body);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff; border-radius:12px;">
<tr><td style="padding: 28px 32px 8px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#FF285C;">🎤 Komentarz polityczny</p>
</td></tr>
${
  title
    ? `<tr><td style="padding: 12px 32px 8px 32px;" class="mobile-padding">
  <h2 class="section-title" style="margin:0; font-size:22px; font-weight:800; color:#333E53; line-height:28px;">${title}</h2>
</td></tr>`
    : ''
}
${
  highlight
    ? `<tr><td style="padding: 12px 32px 0 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#fce4ec" style="background-color:#fce4ec; background-image:linear-gradient(135deg, #fef0f0, #fce4ec); border-radius:10px;">
  <tr><td style="padding: 20px 24px;">
    <p style="margin:0; font-size:18px; font-weight:700; color:#CC3366; line-height:28px; font-style:italic;">„${highlight}”</p>
  </td></tr>
  </table>
</td></tr>`
    : ''
}
<tr><td style="padding: 16px 32px 28px 32px;" class="mobile-padding">
  ${body}
</td></tr>
</table>`;
}

// ============================================================================
// Z regionu (etykieta = region z naglowka)
// ============================================================================

function renderRegionNews(s: RegionNewsSection, region: string, ctx: RenderCtx): string {
  const img = imageSrc(s.image_url, ctx, 496, 320);
  const title = escapeHtml(s.title);
  const label = escapeHtml(region);
  const body = textToHtml(s.body);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff; border-radius:12px;">
<tr><td style="padding: 28px 32px 8px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#28367A;">🌲 ${label}</p>
</td></tr>
${
  title
    ? `<tr><td style="padding: 8px 32px 4px 32px;" class="mobile-padding">
  <h2 class="section-title" style="margin:0; font-size:20px; font-weight:800; color:#333E53; line-height:26px;">
    ${title}
  </h2>
</td></tr>`
    : ''
}
${
  img
    ? `<tr><td style="padding: 12px 32px 0 32px;" class="mobile-padding">
  <img src="${img}" alt="${title || label}" width="496" style="width:100%; display:block; border-radius:10px;" />
</td></tr>`
    : ''
}
<tr><td style="padding: 16px 32px 28px 32px;" class="mobile-padding">
  ${body}
</td></tr>
</table>`;
}

// ============================================================================
// Okiem eksperta
// ============================================================================

function renderExpert(s: ExpertSection): string {
  const title = escapeHtml(s.title);
  const tag1 = escapeHtml(s.tag1);
  const tag2 = escapeHtml(s.tag2);
  const body = textToHtml(s.body);
  const link = safeUrl(s.link_url);
  const linkLabel = escapeHtml(s.link_label || 'Przeczytaj pełną analizę');

  const tags = tag1 || tag2
    ? `
<tr><td style="padding: 8px 32px 12px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  ${tag1 ? `<td style="background:#fce4ec; border-radius:6px; padding:4px 12px;"><p style="margin:0; font-size:11px; font-weight:700; color:#FF285C;">${tag1}</p></td>` : ''}
  ${tag2 ? `<td style="padding-left:8px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#e8ecf4; border-radius:6px; padding:4px 12px;"><p style="margin:0; font-size:11px; font-weight:700; color:#28367A;">${tag2}</p></td></tr></table></td>` : ''}
  </tr></table>
</td></tr>`
    : '';

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff; border-radius:12px;">
<tr><td style="padding: 28px 32px 8px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#FF285C;">🔬 Okiem eksperta</p>
</td></tr>
${
  title
    ? `<tr><td style="padding: 12px 32px 8px 32px;" class="mobile-padding">
  <h2 class="section-title" style="margin:0; font-size:20px; font-weight:800; color:#333E53; line-height:26px;">${title}</h2>
</td></tr>`
    : ''
}
${tags}
<tr><td style="padding: 4px 32px 28px 32px;" class="mobile-padding">
  ${body}
  ${
    link
      ? `<p style="margin:16px 0 0 0;"><a href="${link}" style="font-size:14px; font-weight:700; color:#FF285C; text-decoration:underline;">${linkLabel} →</a></p>`
      : ''
  }
</td></tr>
</table>`;
}

// ============================================================================
// Liczba tygodnia
// ============================================================================

function renderNumber(s: NumberSection): string {
  const value = escapeHtml(s.value);
  const context = escapeHtml(s.context);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#28367A" style="background-color:#28367A; background-image:linear-gradient(135deg, #1a2231 0%, #28367A 100%); border-radius:12px;">
<tr><td align="center" style="padding: 40px 32px 12px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:2px; color:#A9AFBF;">📊 Liczba tygodnia</p>
</td></tr>
<tr><td align="center" style="padding: 8px 32px 8px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:64px; font-weight:800; color:#ffffff; letter-spacing:-2px; line-height:1;">${value}</p>
</td></tr>
<tr><td align="center" style="padding: 12px 32px 40px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:16px; color:#D4D7DE; line-height:24px; max-width:400px;">${context}</p>
</td></tr>
</table>`;
}

// ============================================================================
// W mediach
// ============================================================================

function renderMedia(s: MediaSection, ctx: RenderCtx): string {
  const items = s.items.filter((i) => i.title.trim() || i.link_url || i.image_url);
  if (!items.length) return '';

  const rows = items
    .map((i) => {
      const img = imageSrc(i.image_url, ctx, 100, 100, 'Zdjęcie');
      const link = safeUrl(i.link_url);
      const title = escapeHtml(i.title);
      const meta = escapeHtml(i.outlet_date);
      return `
<tr><td style="padding: 0 32px 12px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc; border-radius:10px;">
  <tr>
    ${
      img
        ? `<td width="100" style="padding:12px;">
      <img src="${img}" alt="${title || 'Wystąpienie w mediach'}" width="100" style="border-radius:8px; display:block;" />
    </td>`
        : ''
    }
    <td style="padding:${img ? '12px 16px 12px 4px' : '12px 16px'}; vertical-align:middle;">
      <p style="margin:0; font-size:14px; font-weight:700; color:#333E53; line-height:20px;">
        ${link ? `<a href="${link}" style="color:#333E53; text-decoration:none;">${title}</a>` : title}
      </p>
      ${meta ? `<p style="margin:4px 0 0 0; font-size:12px; color:#76829D;">${meta}</p>` : ''}
    </td>
  </tr>
  </table>
</td></tr>`;
    })
    .join('');

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff; border-radius:12px;">
<tr><td style="padding: 28px 32px 16px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#28367A;">📺 W mediach</p>
</td></tr>
${rows}
<tr><td style="height:16px;"></td></tr>
</table>`;
}

// ============================================================================
// Rolka tygodnia
// ============================================================================

function renderReel(s: ReelSection, ctx: RenderCtx): string {
  const img = imageSrc(s.image_url, ctx, 300, 380);
  const title = escapeHtml(s.title);
  const ig = safeUrl(s.instagram_url);
  const tt = safeUrl(s.tiktok_url);
  const thumbLink = ig || tt;

  const buttons =
    ig || tt
      ? `
<tr><td align="center" style="padding: 4px 32px 28px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  ${
    ig
      ? `<td class="stack-cell" bgcolor="#FF285C" style="background-color:#FF285C; border-radius:10px; padding: 12px 24px;"><a href="${ig}" style="font-size:14px; font-weight:700; color:#ffffff; text-decoration:none;">▶ Obejrzyj na Instagramie</a></td>`
      : ''
  }
  ${ig && tt ? '<td class="mobile-hide" style="width:12px;"></td>' : ''}
  ${
    tt
      ? `<td class="stack-cell" style="background:#f1f5f9; border-radius:10px; padding: 12px 24px;"><a href="${tt}" style="font-size:14px; font-weight:700; color:#333E53; text-decoration:none;">TikTok</a></td>`
      : ''
  }
  </tr></table>
</td></tr>`
      : '';

  const imgTag = img
    ? `<img src="${img}" alt="${title || 'Rolka tygodnia'}" width="300" style="border-radius:16px; display:block;" />`
    : '';

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff; border-radius:12px;">
<tr><td style="padding: 28px 32px 12px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#FF285C;">🎬 Rolka tygodnia</p>
</td></tr>
${
  imgTag
    ? `<tr><td align="center" style="padding: 4px 32px 8px 32px;" class="mobile-padding">
  ${thumbLink ? `<a href="${thumbLink}" style="text-decoration:none;">${imgTag}</a>` : imgTag}
</td></tr>`
    : ''
}
${
  title
    ? `<tr><td align="center" style="padding: 12px 32px 8px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:17px; font-weight:700; color:#333E53;">${title}</p>
</td></tr>`
    : ''
}
${buttons}
</table>`;
}

// ============================================================================
// Zapraszam (wydarzenia)
// ============================================================================

function renderEvents(s: EventsSection): string {
  const items = s.items.filter((e) => e.title.trim() || e.day.trim());
  if (!items.length) return '';

  const rows = items
    .map((e) => {
      const day = escapeHtml(e.day);
      const month = escapeHtml(e.month);
      const title = escapeHtml(e.title);
      const location = escapeHtml(e.location);
      const detail = escapeHtml(e.detail);
      return `
<tr><td style="padding: 0 32px 12px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0F2F8; border-radius:10px; border-left: 4px solid #28367A;">
  <tr><td style="padding: 16px 20px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td width="56" style="vertical-align:top;">
        <p style="margin:0; font-size:28px; font-weight:800; color:#28367A; line-height:1; text-align:center;">${day}</p>
        ${month ? `<p style="margin:2px 0 0 0; font-size:11px; font-weight:700; color:#28367A; text-transform:uppercase; text-align:center;">${month}</p>` : ''}
      </td>
      <td style="padding-left:16px;">
        <p style="margin:0; font-size:15px; font-weight:700; color:#333E53;">${title}</p>
        ${location ? `<p style="margin:4px 0 0 0; font-size:13px; color:#76829D;">${location}</p>` : ''}
        ${detail ? `<p style="margin:4px 0 0 0; font-size:13px; color:#76829D;">${detail}</p>` : ''}
      </td>
    </tr>
    </table>
  </td></tr>
  </table>
</td></tr>`;
    })
    .join('');

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff; border-radius:12px;">
<tr><td style="padding: 28px 32px 16px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#28367A;">📌 Zapraszam</p>
</td></tr>
${rows}
<tr><td style="height:16px;"></td></tr>
</table>`;
}

// ============================================================================
// Pytanie do czytelnikow
// ============================================================================

function renderReaderQuestion(s: ReaderQuestionSection): string {
  const question = escapeHtml(s.question);
  const options = s.options.filter((o) => o.label.trim());
  if (!question && !options.length) return '';

  const optionCells = options
    .map((o, idx) => {
      const label = escapeHtml(o.label);
      const link = safeUrl(o.link_url);
      const primary = idx === 0;
      const textStyle = `font-size:15px; font-weight:700; color:${primary ? '#28367A' : '#ffffff'}; text-decoration:none;`;
      const content = link ? `<a href="${link}" style="${textStyle}">${label}</a>` : `<span style="${textStyle}">${label}</span>`;
      const cell = primary
        ? `<td class="stack-cell" bgcolor="#ffffff" style="background:#ffffff; border-radius:10px; padding: 12px 28px;">${content}</td>`
        : `<td class="stack-cell" style="background:rgba(255,255,255,0.2); border:2px solid #ffffff; border-radius:10px; padding: 12px 28px;">${content}</td>`;
      return primary ? cell : `<td class="mobile-hide" style="width:12px;"></td>${cell}`;
    })
    .join('');

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#FF285C" style="background-color:#FF285C; background-image:linear-gradient(135deg, #FF285C, #CC3366); border-radius:12px;">
<tr><td align="center" style="padding: 36px 32px 12px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:2px; color:#D4D7DE;">🗳️ Pytanie do Ciebie</p>
</td></tr>
${
  question
    ? `<tr><td align="center" style="padding: 8px 32px 24px 32px;" class="mobile-padding">
  <h2 style="margin:0; font-size:22px; font-weight:800; color:#ffffff; line-height:30px;">${question}</h2>
</td></tr>`
    : ''
}
${
  optionCells
    ? `<tr><td align="center" style="padding: 0 32px 36px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${optionCells}</tr></table>
</td></tr>`
    : ''
}
</table>`;
}

// ============================================================================
// Fact-check
// ============================================================================

const VERDICT_STYLE: Record<
  FactCheckSection['verdict'],
  { label: string; bg: string; color: string }
> = {
  manipulacja: { label: '❌ MANIPULACJA', bg: '#fce4ec', color: '#CC3366' },
  falsz: { label: '❌ FAŁSZ', bg: '#fce4ec', color: '#CC3366' },
  czesciowa: { label: '⚠️ CZĘŚCIOWA PRAWDA', bg: '#fef3c7', color: '#92400e' },
  prawda: { label: '✅ PRAWDA', bg: '#dcfce7', color: '#16a34a' },
};

function renderFactCheck(s: FactCheckSection): string {
  const statement = escapeHtml(s.statement);
  const source = escapeHtml(s.statement_source);
  const link = safeUrl(s.source_link);
  const explanation = textToHtml(s.explanation, {
    trailingGap: false,
    suffixHtml: link ? ` <a href="${link}" style="color:#28367A; font-weight:600;">Źródło danych →</a>` : '',
  });
  const v = VERDICT_STYLE[s.verdict] ?? VERDICT_STYLE.manipulacja;

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff; border-radius:12px;">
<tr><td style="padding: 28px 32px 8px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#CC3366;">🔎 Fact-check</p>
</td></tr>
<tr><td style="padding: 12px 32px 12px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fef0f0; border-radius:10px;">
  <tr><td style="padding: 16px 20px;">
    <p style="margin:0; font-size:13px; font-weight:600; color:#CC3366;">Stwierdzenie:</p>
    <p style="margin:6px 0 0 0; font-size:16px; font-weight:700; color:#333E53; line-height:24px; font-style:italic;">„${statement}”</p>
    ${source ? `<p style="margin:6px 0 0 0; font-size:12px; color:#76829D;">— ${source}</p>` : ''}
  </td></tr>
  </table>
</td></tr>
<tr><td style="padding: 8px 32px 12px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr><td style="background:${v.bg}; border-radius:8px; padding: 8px 20px;">
    <p style="margin:0; font-size:14px; font-weight:800; color:${v.color};">${v.label}</p>
  </td></tr>
  </table>
</td></tr>
<tr><td style="padding: 8px 32px 28px 32px;" class="mobile-padding">
  ${explanation}
</td></tr>
</table>`;
}

// ============================================================================
// Galeria
// ============================================================================

function renderGallery(s: GallerySection, ctx: RenderCtx): string {
  // Mail: tylko poprawne zdjecia. Podglad: kazdy slot, puste jako placeholder.
  const srcs = s.images.map((i) => imageSrc(i.url, ctx, 242, 242)).filter(Boolean);
  if (!srcs.length) return '';
  const label = escapeHtml(s.label || 'Z tego tygodnia');

  const imgTag = (src: string, n: number) =>
    `<img src="${src}" alt="${label} – zdjęcie ${n}" width="242" style="width:100%; border-radius:10px; display:block;" />`;

  // Grupuj po 2 obrazy w wierszu (siatka 2xN)
  const rows: string[] = [];
  for (let i = 0; i < srcs.length; i += 2) {
    const right = srcs[i + 1];
    const isLast = i + 2 >= srcs.length;
    const cellPadBottom = isLast ? '0' : '8px';
    rows.push(`
  <tr>
    <td width="49%" style="padding:0 4px ${cellPadBottom} 0;">
      ${imgTag(srcs[i], i + 1)}
    </td>
    <td width="49%" style="padding:0 0 ${cellPadBottom} 4px;">
      ${right ? imgTag(right, i + 2) : ''}
    </td>
  </tr>`);
  }

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff; border-radius:12px;">
<tr><td style="padding: 28px 32px 16px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#28367A;">📸 ${label}</p>
</td></tr>
<tr><td style="padding: 0 32px 28px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  ${rows.join('')}
  </table>
</td></tr>
</table>`;
}

// ============================================================================
// Cytat tygodnia
// ============================================================================

function renderQuote(s: QuoteSection): string {
  const body = escapeHtml(s.body);
  const author = escapeHtml(s.author);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#28367A" style="background-color:#28367A; background-image:linear-gradient(135deg, #1a2231, #28367A); border-radius:12px;">
<tr><td align="center" style="padding: 40px 40px 16px 40px;" class="mobile-padding">
  <p style="margin:0; font-size:40px; line-height:1;">💬</p>
</td></tr>
<tr><td align="center" style="padding: 0 40px 16px 40px;" class="mobile-padding">
  <p style="margin:0; font-size:20px; font-weight:600; color:#ffffff; line-height:32px; font-style:italic;">
    „${body}”
  </p>
</td></tr>
${
  author
    ? `<tr><td align="center" style="padding: 0 40px 40px 40px;" class="mobile-padding">
  <p style="margin:0; font-size:14px; color:#94a3b8; font-weight:600;">
    — ${author}
  </p>
</td></tr>`
    : '<tr><td style="height:24px;"></td></tr>'
}
</table>`;
}

// ============================================================================
// Polecam
// ============================================================================

function renderRecommend(s: RecommendSection, ctx: RenderCtx): string {
  const items = s.items.filter((i) => i.title.trim() || i.link_url);
  if (!items.length) return '';

  const rows = items
    .map((i) => {
      const img = imageSrc(i.image_url, ctx, 90, 90, 'Zdjęcie');
      const kind = escapeHtml(i.kind);
      const title = escapeHtml(i.title);
      const link = safeUrl(i.link_url);
      const description = escapeHtml(i.description);
      return `
<tr><td style="padding: 0 32px 12px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fef0f0; border-radius:10px;">
  <tr>
    ${
      img
        ? `<td width="90" style="padding:16px;">
      <img src="${img}" alt="${title || 'Polecam'}" width="90" style="border-radius:8px; display:block;" />
    </td>`
        : ''
    }
    <td style="padding:${img ? '16px 16px 16px 4px' : '16px'}; vertical-align:middle;">
      ${kind ? `<p style="margin:0; font-size:11px; font-weight:700; color:#CC3366; text-transform:uppercase;">${kind}</p>` : ''}
      <p style="margin:${kind ? '6px' : '0'} 0 0 0; font-size:16px; font-weight:700; color:#333E53; line-height:22px;">
        ${link ? `<a href="${link}" style="color:#333E53; text-decoration:none;">${title}</a>` : title}
      </p>
      ${description ? `<p style="margin:6px 0 0 0; font-size:13px; color:#76829D; line-height:20px;">${description}</p>` : ''}
    </td>
  </tr>
  </table>
</td></tr>`;
    })
    .join('');

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff; border-radius:12px;">
<tr><td style="padding: 28px 32px 16px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#FF285C;">⭐ Polecam</p>
</td></tr>
${rows}
<tr><td style="height:16px;"></td></tr>
</table>`;
}

// ============================================================================
// Footer
// ============================================================================

function renderFooter(f: FooterSection, ctx: RenderCtx): string {
  const officeName = escapeHtml(f.office_name);
  const address = escapeHtml(f.office_address);
  const email = escapeAttr(f.contact_email);
  const emailLabel = escapeHtml(f.contact_email);
  const privacy = safeUrl(f.privacy_url);
  // Administrator danych: posel z site_identity ("Jan Kowalski, poseł na Sejm RP"), bez nazwiska - biuro ze stopki.
  const mpName = ctx.identity.mp_name.trim();
  const title = mpTitle(ctx.identity);
  const controller = mpName
    ? `${escapeHtml(mpName)}, ${escapeHtml(title.charAt(0).toLowerCase() + title.slice(1))}`
    : officeName;

  const social = [
    { label: 'X', url: safeUrl(f.social_x) },
    { label: 'Facebook', url: safeUrl(f.social_facebook) },
    { label: 'Instagram', url: safeUrl(f.social_instagram) },
    { label: 'TikTok', url: safeUrl(f.social_tiktok) },
    { label: 'YouTube', url: safeUrl(f.social_youtube) },
  ].filter((s) => s.url);

  const socialBlock =
    social.length > 0
      ? `<tr><td align="center" style="padding: 32px 32px 16px 32px;" class="mobile-padding">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
${social
  .map(
    (s) => `    <td style="padding:0 8px;">
      <a href="${s.url}" style="font-size:13px; color:#94a3b8; text-decoration:underline; font-weight:600;">${escapeHtml(s.label)}</a>
    </td>`,
  )
  .join('\n')}
  </tr></table>
</td></tr>`
      : '';

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#1a2231" style="background-color:#1a2231; border-radius: 0 0 16px 16px;">
${socialBlock}
<tr><td align="center" style="padding: ${social.length > 0 ? '8px' : '32px'} 32px 8px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:14px; font-weight:600; color:#e2e8f0;">${officeName}</p>
  ${address ? `<p style="margin:4px 0 0 0; font-size:13px; color:#94a3b8;">${address}</p>` : ''}
  ${
    email
      ? `<p style="margin:4px 0 0 0; font-size:13px; color:#94a3b8;">
    📧 <a href="mailto:${email}" style="color:#A9AFBF; text-decoration:none;">${emailLabel}</a>
  </p>`
      : ''
  }
</td></tr>
<tr><td align="center" style="padding: 20px 32px 12px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:11px; color:#A9AFBF; line-height:18px;">
    ${ctx.web ? 'To jest wersja online newslettera.' : 'Otrzymujesz tę wiadomość, ponieważ zapisałeś/aś się na newsletter.'}
  </p>
</td></tr>${
  ctx.web
    ? ''
    : `
<tr><td align="center" style="padding: 0 32px 12px 32px;" class="mobile-padding">
  <a href="[[remove]]" style="font-size:12px; color:#A9AFBF; text-decoration:underline; font-weight:600;">Wypisz się z newslettera</a>
</td></tr>`
}
<tr><td align="center" style="padding: 0 32px 32px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:10px; color:#8C95A8; line-height:16px;">
    Administratorem Twoich danych osobowych jest ${controller}.<br>
    Dane przetwarzane są na podstawie Twojej zgody (art. 6 ust. 1 lit. a RODO) w celu wysyłki newslettera.<br>
    Masz prawo do wycofania zgody, dostępu do danych, ich sprostowania, usunięcia i przenoszenia.${
      privacy ? `<br>\n    <a href="${privacy}" style="color:#A9AFBF; text-decoration:underline;">Polityka prywatności</a>` : ''
    }
  </p>
</td></tr>
</table>`;
}

// ============================================================================
// Rejestr sekcji wymiennych
// ============================================================================

interface SectionDef {
  /** Tresc komentarza HTML `<!-- ... -->` przed blokiem. */
  comment: string;
  /** Naglowek pustej sekcji w podgladzie. */
  label: string;
  /** Wewnetrzny blok sekcji; '' = brak tresci (mail: pomijamy, podglad: pusty blok). */
  render: (t: NewsletterTemplate, ctx: RenderCtx) => string;
}

const SECTIONS: Record<SectionKey, SectionDef> = {
  lead: { comment: 'LEAD / TEMAT TYGODNIA', label: 'Temat tygodnia', render: (t, ctx) => renderLead(t.lead, ctx) },
  sejm: { comment: 'CO W SEJMIE', label: '🏛️ Co w Sejmie?', render: (t) => renderSejm(t.sejm) },
  commentary: { comment: 'KOMENTARZ POLITYCZNY', label: '🎤 Komentarz polityczny', render: (t) => renderCommentary(t.commentary) },
  region_news: { comment: 'Z REGIONU', label: '🌲 Z regionu', render: (t, ctx) => renderRegionNews(t.region_news, regionLabel(t), ctx) },
  expert: { comment: 'OKIEM EKSPERTA', label: '🔬 Okiem eksperta', render: (t) => renderExpert(t.expert) },
  number_of_week: { comment: 'LICZBA TYGODNIA', label: '📊 Liczba tygodnia', render: (t) => renderNumber(t.number_of_week) },
  media: { comment: 'W MEDIACH', label: '📺 W mediach', render: (t, ctx) => renderMedia(t.media, ctx) },
  reel: { comment: 'ROLKA TYGODNIA', label: '🎬 Rolka tygodnia', render: (t, ctx) => renderReel(t.reel, ctx) },
  events: { comment: 'ZAPRASZAM', label: '📌 Zapraszam', render: (t) => renderEvents(t.events) },
  reader_question: { comment: 'PYTANIE DO CZYTELNIKOW', label: '🗳️ Pytanie do Ciebie', render: (t) => renderReaderQuestion(t.reader_question) },
  fact_check: { comment: 'FACT-CHECK', label: '🔎 Fact-check', render: (t) => renderFactCheck(t.fact_check) },
  gallery: { comment: 'GALERIA', label: '📸 Galeria', render: (t, ctx) => renderGallery(t.gallery, ctx) },
  quote: { comment: 'CYTAT TYGODNIA', label: '💬 Cytat tygodnia', render: (t) => renderQuote(t.quote) },
  recommend: { comment: 'POLECAM', label: '⭐ Polecam', render: (t, ctx) => renderRecommend(t.recommend, ctx) },
};

// ============================================================================
// Pelny renderer
// ============================================================================

const PREVIEW_STYLE = `
  <style type="text/css">
    [data-section]{cursor:pointer}
    [data-section]:hover>td{outline:2px dashed rgba(255,40,92,.55);outline-offset:-3px}
    [data-section][data-active]>td{outline:2px solid #FF285C;outline-offset:-3px}
  </style>`;

export function renderNewsletter(t: NewsletterTemplate, opts: RenderOptions): string {
  const mode = opts.mode ?? 'email';
  const ctx: RenderCtx = { preview: mode === 'preview', web: mode === 'web', identity: opts.identity };
  const preheader = escapeHtml(t.preheader || '');
  const webUrl = safeUrl(opts.webUrl);
  // Podglad pokazuje pasek zawsze (link powstaje dopiero przy wysylce); wersja online go nie potrzebuje.
  const viewOnlineBar =
    ctx.web || (!webUrl && !ctx.preview)
      ? ''
      : `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#DCDDE1" style="background-color:#DCDDE1; font-family:${FONT_STACK};">
<tr><td align="center" style="padding: 12px 10px 0 10px;">
  <p style="margin:0; font-size:12px; color:#76829D;">
    Nie wyświetla się poprawnie? <a${webUrl ? ` href="${webUrl}"` : ''} style="color:#28367A; font-weight:600; text-decoration:underline;">Wyświetl w przeglądarce</a>
  </p>
</td></tr>
</table>`;

  const blocks = [wrapBlock('header', 'HEADER', renderHeader(t.header, t.footer.office_name, ctx), ctx)];
  for (const key of t.sections) {
    const def = SECTIONS[key];
    let inner = def.render(t, ctx);
    // Podglad: sekcja bez tresci nadal widoczna (i klikalna) jako pusty blok; mail ja pomija.
    if (!inner && ctx.preview) {
      inner = `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff; border-radius:12px;">
<tr><td style="padding: 28px 32px;" class="mobile-padding">
  <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#A9AFBF;">${escapeHtml(def.label)}</p>
  <p style="margin:8px 0 0 0; font-size:14px; color:#76829D;">Sekcja jest pusta – uzupełnij ją w edytorze.</p>
</td></tr>
</table>`;
    }
    if (inner) blocks.push(wrapBlock(key, def.comment, inner, ctx) + SPACER);
  }
  blocks.push(wrapBlock('footer', 'FOOTER', renderFooter(t.footer, ctx), ctx));

  return `<!DOCTYPE html>
<html lang="pl" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">${ctx.web ? '\n  <meta name="robots" content="noindex, nofollow">' : ''}
  <title>${escapeHtml(t.subject)}</title>
  <style type="text/css">
    ${fontFaceCss(ctx)}
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; height: 100% !important; background-color: #DCDDE1; }
    .body-fallback { font-family: ${FONT_STACK}; }
    @media only screen and (max-width: 620px) {
      .wrapper { width: 100% !important; }
      .mobile-padding { padding-left: 16px !important; padding-right: 16px !important; }
      .mobile-hide { display: none !important; }
      .stack-cell { display: block !important; width: auto !important; margin: 0 0 10px 0 !important; text-align: center; }
      .hero-title { font-size: 26px !important; line-height: 32px !important; }
      .section-title { font-size: 20px !important; }
      .vote-bar { min-width: 20px !important; }
    }
  </style>${ctx.preview ? PREVIEW_STYLE : ''}
</head>
<body class="body-fallback" style="margin:0; padding:0; background-color:#DCDDE1;">
<div style="display:none !important; visibility:hidden; mso-hide:all; font-size:1px; color:#DCDDE1; line-height:1px; max-height:0px; max-width:0px; opacity:0; overflow:hidden;">
  ${preheader || '&zwnj;'}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;
</div>
${viewOnlineBar}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#DCDDE1" style="background-color:#DCDDE1; font-family:${FONT_STACK};">
<tr><td align="center" style="padding: 20px 10px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" class="wrapper" style="width:560px; max-width:560px; font-family:${FONT_STACK};">
${blocks.join('\n')}
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ============================================================================
// Plain text fallback (dla GR content.plain) - prosty render z minimum struktury
// ============================================================================

/** [naglowek, ...linie] albo null gdy sekcja nie ma tresci. Galeria pomijana w plain text. */
type PlainBlock = [label: string, ...body: string[]] | null;

const PLAIN_SECTIONS: Record<SectionKey, (t: NewsletterTemplate) => PlainBlock> = {
  lead: ({ lead }) =>
    lead.title ? ['TEMAT TYGODNIA', lead.title, lead.description, lead.link_url ? `-> ${lead.link_url}` : ''] : null,
  sejm: ({ sejm }) => {
    if (!sejm.title && !sejm.comment) return null;
    const clubLines = sejm.clubs
      .filter((c) => c.name.trim() && c.za + c.przeciw + c.wstrzymal + c.nieobecny > 0)
      .map((c) => `${c.name}: za ${c.za} / przeciw ${c.przeciw} / wstrzym. ${c.wstrzymal} / nieob. ${c.nieobecny}`);
    return ['CO W SEJMIE', sejm.title, sejm.sitting_label, ...clubLines, sejm.comment];
  },
  commentary: ({ commentary: c }) =>
    c.title || c.body ? ['KOMENTARZ POLITYCZNY', c.title, c.highlight ? `„${c.highlight}”` : '', c.body] : null,
  region_news: (t) => (t.region_news.title ? [regionLabel(t).toUpperCase(), t.region_news.title, t.region_news.body] : null),
  expert: ({ expert: e }) =>
    e.title || e.body ? ['OKIEM EKSPERTA', e.title, e.body, e.link_url ? `-> ${e.link_url}` : ''] : null,
  number_of_week: ({ number_of_week: n }) => (n.value ? ['LICZBA TYGODNIA', n.value, n.context] : null),
  media: ({ media }) => {
    const items = media.items.filter((i) => i.title.trim() || i.link_url);
    if (!items.length) return null;
    return [
      'W MEDIACH',
      ...items.map((i) => `- ${i.title}${i.outlet_date ? ` (${i.outlet_date})` : ''}${i.link_url ? ` ${i.link_url}` : ''}`),
    ];
  },
  reel: ({ reel }) =>
    reel.title || reel.instagram_url || reel.tiktok_url
      ? [
          'ROLKA TYGODNIA',
          reel.title,
          reel.instagram_url ? `Instagram: ${reel.instagram_url}` : '',
          reel.tiktok_url ? `TikTok: ${reel.tiktok_url}` : '',
        ]
      : null,
  events: ({ events }) => {
    const items = events.items.filter((e) => e.title.trim() || e.day.trim());
    if (!items.length) return null;
    return ['ZAPRASZAM', ...items.map((e) => `- ${e.day} ${e.month} ${e.title}${e.location ? ` (${e.location})` : ''}`)];
  },
  reader_question: ({ reader_question: q }) => {
    if (!q.question) return null;
    const opts = q.options.filter((o) => o.label.trim()).map((o) => `- ${o.label}${o.link_url ? ` ${o.link_url}` : ''}`);
    return ['PYTANIE DO CZYTELNIKÓW', q.question, ...opts];
  },
  fact_check: ({ fact_check: f }) =>
    f.statement
      ? [
          'FACT-CHECK',
          `„${f.statement}”`,
          f.statement_source ? `— ${f.statement_source}` : '',
          VERDICT_STYLE[f.verdict]?.label ?? '',
          f.explanation,
          f.source_link ? `-> ${f.source_link}` : '',
        ]
      : null,
  gallery: () => null,
  quote: ({ quote }) => (quote.body ? ['CYTAT TYGODNIA', `„${quote.body}”`, quote.author ? `— ${quote.author}` : ''] : null),
  recommend: ({ recommend }) => {
    const items = recommend.items.filter((i) => i.title.trim() || i.link_url);
    if (!items.length) return null;
    return ['POLECAM', ...items.map((i) => `- ${i.kind ? `[${i.kind}] ` : ''}${i.title}${i.link_url ? ` ${i.link_url}` : ''}`)];
  },
};

export function renderNewsletterPlain(t: NewsletterTemplate, webUrl?: string): string {
  const lines: string[] = [];

  if (webUrl) {
    lines.push(`Wersja online: ${webUrl}`);
    lines.push('');
  }
  lines.push(`Cześć, ${t.header.greeting_first_token || '[[firstname]]'}!`);
  lines.push('');

  for (const key of t.sections) {
    const block = PLAIN_SECTIONS[key](t);
    if (!block) continue;
    const [label, ...body] = block;
    lines.push(`=== ${label} ===`);
    body.filter(Boolean).forEach((b) => lines.push(b));
    lines.push('');
  }

  lines.push('---');
  lines.push(t.footer.office_name);
  if (t.footer.office_address) lines.push(t.footer.office_address);
  lines.push(t.footer.contact_email);
  lines.push('');
  lines.push('Wypisz się: [[remove]]');
  return lines.join('\n');
}

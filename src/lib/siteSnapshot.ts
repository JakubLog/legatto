import { z } from 'zod';
import { parseSiteContent } from './siteContent.js';

// Migawka danych strony posła - wynik public.service_site_snapshot() (schema_version 1,
// migracja 20261121220000_site_publish.sql). Jedno źródło treści dla:
//   - generatora strony statycznej (site/: snapshot -> build, wyspy React),
//   - strony głównej SPA w trybie Vercel i podglądu w CRM (api/public-site.ts -> usePublicSite).
// Import względny (bez aliasu `@/`), bo plik czyta też api/ (Node, bez bundlera Vite).
//
// Zasoby (zdjęcia) w migawce z bazy to absolutne URL-e publicznego Storage albo ścieżki w buckecie
// (`posts.cover_path`); generator (site/snapshot.ts) przepisuje je na /assets/<sha256>.<ext>,
// a obrazy newslettera na /n/a/<sha256>.<ext>.

const text = z.string();
const nullableText = z.string().nullable();
/** Znacznik czasu z to_jsonb(timestamptz) / to_char - dowolny ISO 8601 rozumiany przez Date.parse. */
const timestamp = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Niepoprawna data');
const dbId = z.number().int().positive();

export const siteOfficeSchema = z.object({
  id: z.string().min(1),
  name: text,
  city: text,
  address: nullableText,
  phone: nullableText,
  email: nullableText,
  is_main: z.boolean(),
});
export type SiteOffice = z.infer<typeof siteOfficeSchema>;

export const siteStaffMemberSchema = z.object({
  id: z.string().min(1),
  office_id: z.string().min(1),
  full_name: text,
  role: z.enum(['posel', 'administrator', 'pracownik', 'asystent']),
  phone: nullableText,
  avatar_url: nullableText,
});
export type SiteStaffMember = z.infer<typeof siteStaffMemberSchema>;

export const siteEventSchema = z.object({
  id: z.string().min(1),
  title: text,
  description: nullableText,
  type: z.enum(['spotkanie', 'wyjazd', 'media', 'inne']),
  starts_at: timestamp,
  ends_at: timestamp.nullable(),
  all_day: z.boolean(),
  location: nullableText,
  powiat_name: nullableText,
  gmina_name: nullableText,
});
export type SiteEvent = z.infer<typeof siteEventSchema>;

export const siteDictionariesSchema = z.object({
  powiaty: z.array(
    z.object({ id: dbId, name: text, is_city: z.boolean(), lat: z.number().nullable(), lng: z.number().nullable() }),
  ),
  gminy: z.array(z.object({ id: dbId, powiat_id: dbId, name: text, type: text })),
  categories: z.array(z.object({ id: dbId, name: text, slug: text, color: nullableText })),
});
export type SiteDictionaries = z.infer<typeof siteDictionariesSchema>;

/** app_settings.district (jak src/hooks/useDistrict.ts); brak albo niepoprawny = instancja bez okręgu. */
export const siteDistrictSchema = z.object({
  number: z.number().int().min(1).max(41),
  highlighted_powiat_id: z.number().int().nullable().catch(null),
  highlighted_gmina_id: z.number().int().nullable().catch(null),
  highlight_label: z.string().trim().max(80).catch(''),
});
export type SiteDistrict = z.infer<typeof siteDistrictSchema>;

export const POST_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
export const NEWSLETTER_SLUG_RE = /^[A-Za-z0-9_-]{16}$/;
export const ASSET_EXTENSIONS = ['png', 'jpg', 'webp', 'gif'] as const;
export type AssetExtension = (typeof ASSET_EXTENSIONS)[number];

export const sitePostSchema = z.object({
  slug: z.string().regex(POST_SLUG_RE),
  title: text,
  excerpt: nullableText.transform((v) => v ?? ''),
  body_md: text,
  /** Z bazy: '' albo `blog/<plik>` w buckecie site-assets; po `snapshot`: '' albo /assets/<sha256>.<ext>. */
  cover_path: nullableText.transform((v) => v ?? ''),
  published_at: timestamp,
  updated_at: timestamp,
});
export type SitePost = z.infer<typeof sitePostSchema>;

export const siteNewsletterSchema = z.object({
  slug: z.string().regex(NEWSLETTER_SLUG_RE),
  subject: nullableText.transform((v) => v ?? ''),
  html_web: nullableText.transform((v) => v ?? ''),
  published_at: timestamp.nullable(),
});
export type SiteNewsletter = z.infer<typeof siteNewsletterSchema>;

export const siteNewsletterAssetSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  ext: z.enum(ASSET_EXTENSIONS),
  /** Z bazy: ścieżka obiektu w buckecie newsletter-assets; po `snapshot`: assets/<sha256>.<ext>. */
  path: z.string().min(1),
});
export type SiteNewsletterAsset = z.infer<typeof siteNewsletterAssetSchema>;

const publicSiteShape = {
  schema_version: z.literal(1),
  generated_at: timestamp,
  public_site_url: z.string(),
  /** app_settings.site_identity / homepage - odporny odczyt parseSiteContent (złe pole = domyślne). */
  identity: z.unknown(),
  homepage: z.unknown(),
  district: z.unknown().transform((v) => siteDistrictSchema.safeParse(v).data ?? null),
  offices: z.array(siteOfficeSchema),
  staff: z.array(siteStaffMemberSchema),
  events: z.array(siteEventSchema),
  dictionaries: siteDictionariesSchema,
};

function withContent<T extends { identity: unknown; homepage: unknown }>(raw: T) {
  const content = parseSiteContent({ identity: raw.identity, homepage: raw.homepage });
  return { ...raw, identity: content.identity, homepage: content.homepage };
}

/** Dane strony głównej (bez wpisów bloga i newsletterów) - odpowiedź GET /api/public-site. */
export const publicSiteSchema = z.object(publicSiteShape).transform(withContent);
export type PublicSiteData = z.output<typeof publicSiteSchema>;

/** Pełna migawka - wejście generatora strony statycznej (snapshot.json). */
export const siteSnapshotSchema = z
  .object({
    ...publicSiteShape,
    posts: z.array(sitePostSchema),
    newsletters: z.array(siteNewsletterSchema),
    newsletter_assets: z.array(siteNewsletterAssetSchema),
  })
  .transform(withContent);
export type SiteSnapshot = z.output<typeof siteSnapshotSchema>;

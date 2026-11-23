// Dane posła instancji (jedna instancja = jeden poseł) dla serwera: prompty PoliAI i MCP, opisy narzędzi.
// Źródło: app_settings.site_identity (JSONB) - ten sam rekord co w src/lib/siteContent.ts, czytany
// service clientem. Serwer nie importuje z src/, więc kształt i formy (mpForms) są tu powielone -
// zmiany trzeba robić w obu miejscach.
// Walidacja luźna: złe albo brakujące pole dostaje neutralną wartość, błąd odczytu = same neutralne
// wartości (prompt ma działać także bez skonfigurowanej instancji).

import { getServiceClient } from './supabase.js';
import { DbError, errorSummary } from './log-safe.js';

export type MpGender = 'm' | 'f';

export interface SiteIdentityServer {
  /** "Jan Kowalski"; pusty = brak danych posła. */
  mp_name: string;
  /** Dopełniacz: "Jana Kowalskiego". */
  mp_name_genitive: string;
  /** "Poseł na Sejm RP" / "Posłanka na Sejm RP". */
  mp_title: string;
  mp_gender: MpGender;
  /** "Okręg wyborczy nr 1 - Legnica"; pusty = bez okręgu. */
  district_label: string;
  website_url: string;
  photo_url: string;
}

export interface MpForms {
  /** Poseł / Posłanka */
  nominative: string;
  /** Posła / Posłanki */
  genitive: string;
  /** Posłowi / Posłance */
  dative: string;
  /** Posła / Posłankę */
  accusative: string;
  /** Posłem / Posłanką */
  instrumental: string;
  /** Pośle / Posłance */
  locative: string;
}

// Te same formy co src/lib/mpForms.ts.
const FORMS: Record<MpGender, MpForms> = {
  m: {
    nominative: 'Poseł',
    genitive: 'Posła',
    dative: 'Posłowi',
    accusative: 'Posła',
    instrumental: 'Posłem',
    locative: 'Pośle',
  },
  f: {
    nominative: 'Posłanka',
    genitive: 'Posłanki',
    dative: 'Posłance',
    accusative: 'Posłankę',
    instrumental: 'Posłanką',
    locative: 'Posłance',
  },
};

export function mpForms(gender: MpGender): MpForms {
  return FORMS[gender];
}

/** Neutralne wartości - jak DEFAULT_SITE_IDENTITY w src/lib/siteContent.ts. */
export const NEUTRAL_SITE_IDENTITY: SiteIdentityServer = {
  mp_name: '',
  mp_name_genitive: '',
  mp_title: 'Poseł na Sejm RP',
  mp_gender: 'm',
  district_label: '',
  website_url: '',
  photo_url: '',
};

const STRING_FIELDS = [
  'mp_name',
  'mp_name_genitive',
  'mp_title',
  'district_label',
  'website_url',
  'photo_url',
] as const satisfies readonly (keyof SiteIdentityServer)[];

export function parseSiteIdentity(raw: unknown): SiteIdentityServer {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: SiteIdentityServer = { ...NEUTRAL_SITE_IDENTITY };
  for (const field of STRING_FIELDS) {
    const value = source[field];
    if (typeof value === 'string') out[field] = value.trim();
  }
  if (!out.mp_title) out.mp_title = NEUTRAL_SITE_IDENTITY.mp_title;
  out.mp_gender = source.mp_gender === 'f' ? 'f' : 'm';
  return out;
}

/** "Biuro Poselskie Jana Kowalskiego" - albo samo "Biuro Poselskie" bez danych posła. */
export function officeFullName(identity: SiteIdentityServer): string {
  return identity.mp_name_genitive ? `Biuro Poselskie ${identity.mp_name_genitive}` : 'Biuro Poselskie';
}

// Dane posła zmieniają się rzadko - cache w pamięci instancji funkcji. Po błędzie odczytu
// neutralne wartości trzymamy krócej, żeby szybko wrócić do prawdziwych danych.
const CACHE_TTL_MS = 5 * 60 * 1000;
const ERROR_TTL_MS = 30 * 1000;

let cached: { value: SiteIdentityServer; expiresAt: number } | null = null;
let pending: Promise<SiteIdentityServer> | null = null;

async function loadSiteIdentity(): Promise<SiteIdentityServer> {
  try {
    const { data, error } = await getServiceClient()
      .from('app_settings')
      .select('value')
      .eq('key', 'site_identity')
      .maybeSingle();
    if (error) throw new DbError(error, 'app_settings site_identity');
    const value = parseSiteIdentity(data?.value);
    cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch (err) {
    console.error('[siteIdentity] odczyt app_settings.site_identity nieudany:', errorSummary(err));
    cached = { value: NEUTRAL_SITE_IDENTITY, expiresAt: Date.now() + ERROR_TTL_MS };
    return NEUTRAL_SITE_IDENTITY;
  }
}

/** Dane posła instancji; nigdy nie rzuca (przy błędzie - neutralne wartości). */
export function getSiteIdentity(): Promise<SiteIdentityServer> {
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  pending ??= loadSiteIdentity().finally(() => {
    pending = null;
  });
  return pending;
}

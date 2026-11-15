import type { SiteIdentity } from '@/lib/siteContent';

// Odmiana tytułu posła wg `site_identity.mp_gender`. Jedno źródło dla UI (role, teksty portalu,
// zgody RODO, newsletter). Serwerowy odpowiednik: api/_lib/siteIdentity.ts.

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

const FORMS: Record<SiteIdentity['mp_gender'], MpForms> = {
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

export function mpForms(gender: SiteIdentity['mp_gender']): MpForms {
  return FORMS[gender];
}

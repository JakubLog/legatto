import { z } from 'zod';
import {
  buildSubmitRequest,
  parseFormKey,
  submissionFormSchema,
  type SubmissionForm,
  type SubmissionPlaintext,
} from '../../packages/public-submission/src/index';

// Formularz zgłoszeń strony posła. Walidacja = kanoniczny schemat pakietu @legatto/public-submission
// (ten sam sprawdza Worker i legatto-intake). Wysyłka przez strategię przekazaną do formularza:
//   - sealed (strona statyczna): szyfrowanie w przeglądarce kluczem biura z /data/form-key.json,
//     POST /api/submit do Workera (kontrakt: interfejs app↔publicsite §1),
//   - edge (SPA w trybie Vercel): funkcja Supabase public-submit-case (src/lib/publicSubmitEdge.ts).
// Moduł nie importuje klienta Supabase - trafia do bundla strony statycznej.

export { submissionFormSchema, type SubmissionForm };

/** Wartości pól formularza (puste teksty, brak wyboru = null) - przed sprowadzeniem do postaci kanonicznej. */
export interface PublicSubmissionInput {
  reporter_name: string;
  reporter_email: string;
  reporter_phone: string;
  powiat_id: number | null;
  gmina_id: number | null;
  category_id: number | null;
  title: string;
  description: string;
  rodo_consent: boolean;
  consent_newsletter: boolean;
  consent_contacts_db: boolean;
  /** Honeypot - ukryte pole, wypełniają je boty. */
  website: string;
}

export const EMPTY_SUBMISSION_INPUT: PublicSubmissionInput = {
  reporter_name: '',
  reporter_email: '',
  reporter_phone: '',
  powiat_id: null,
  gmina_id: null,
  category_id: null,
  title: '',
  description: '',
  rodo_consent: false,
  consent_newsletter: false,
  consent_contacts_db: false,
  website: '',
};

/** Pola formularza -> kształt kanoniczny (pusty e-mail/telefon = null). Bez walidacji. */
export function toCanonicalDraft(input: PublicSubmissionInput): Record<keyof SubmissionForm, unknown> {
  return {
    reporter_name: input.reporter_name,
    reporter_email: input.reporter_email.trim() || null,
    reporter_phone: input.reporter_phone.trim() || null,
    powiat_id: input.powiat_id,
    gmina_id: input.gmina_id,
    category_id: input.category_id,
    title: input.title,
    description: input.description,
    rodo_consent: input.rodo_consent,
    consent_newsletter: input.consent_newsletter,
    consent_contacts_db: input.consent_contacts_db,
  };
}

/**
 * Schemat dla react-hook-form: błędy kanonicznego schematu przypięte do pól formularza.
 * Wynik = wartości pól bez zmian; postać kanoniczną daje `submissionFormSchema.parse(toCanonicalDraft(...))`.
 */
export const publicSubmissionSchema = z
  .object({
    reporter_name: z.string(),
    reporter_email: z.string(),
    reporter_phone: z.string(),
    powiat_id: z.number().nullable(),
    gmina_id: z.number().nullable(),
    category_id: z.number().nullable(),
    title: z.string(),
    description: z.string(),
    rodo_consent: z.boolean(),
    consent_newsletter: z.boolean(),
    consent_contacts_db: z.boolean(),
    website: z.string(),
  })
  .superRefine((value, ctx) => {
    const result = submissionFormSchema.safeParse(toCanonicalDraft(value));
    if (result.success) return;
    for (const issue of result.error.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
  });

export interface SubmissionResult {
  /** Numer zgłoszenia do pokazania zgłaszającemu (strona statyczna); null = brak numeru. */
  ref: string | null;
}

/** Błąd wysyłki z komunikatem gotowym do pokazania użytkownikowi. */
export class SubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubmissionError';
  }
}

export interface SubmissionStrategy {
  /** Klucz witryny Turnstile; pusty = formularz niedostępny. */
  turnstileSiteKey: string;
  submit(form: SubmissionForm, turnstileToken: string, honeypot: string): Promise<SubmissionResult>;
}

export const FORM_KEY_PATH = '/data/form-key.json';
export const SUBMIT_PATH = '/api/submit';

const REF_RE = /^[0-9a-f]{8}$/;

const SUBMIT_ERROR_MESSAGES: Record<number, string> = {
  400: 'Formularz zawiera niepoprawne dane. Sprawdź pola i spróbuj ponownie.',
  403: 'Weryfikacja zabezpieczenia przed botami nie powiodła się. Spróbuj ponownie.',
  413: 'Zgłoszenie jest za duże. Skróć opis i spróbuj ponownie.',
  429: 'Wysłano zbyt wiele zgłoszeń w krótkim czasie. Spróbuj ponownie za kilka minut.',
};
const GENERIC_ERROR = 'Nie udało się wysłać zgłoszenia. Spróbuj ponownie później albo skontaktuj się z biurem.';
const NETWORK_ERROR = 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.';

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

interface SealedOptions {
  fetch?: FetchFn;
  /** Host strony w plaintext (`site`); domyślnie location.host. */
  host?: () => string;
}

/** Klucz publiczny biura z /data/form-key.json po weryfikacji kid (parseFormKey). */
interface FormKeyMaterial {
  kid: string;
  publicKey: Uint8Array;
}

/**
 * Strategia strony statycznej: zgłoszenie szyfrowane w przeglądarce (sealed box kluczem biura),
 * Worker widzi tylko szyfrogram. 409 stale_key = rotacja klucza: jedno przeładowanie klucza i ponowienie
 * (Worker sprawdza kid przed Turnstile, więc token nie jest jeszcze zużyty).
 */
export function sealedSubmissionStrategy(turnstileSiteKey: string, options: SealedOptions = {}): SubmissionStrategy {
  const doFetch: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const host = options.host ?? (() => window.location.host);
  let cachedKey: FormKeyMaterial | null = null;

  async function loadKey(force: boolean) {
    if (cachedKey && !force) return cachedKey;
    let res: Response;
    try {
      res = await doFetch(FORM_KEY_PATH, { cache: 'no-store', headers: { Accept: 'application/json' } });
    } catch {
      throw new SubmissionError(NETWORK_ERROR);
    }
    if (!res.ok) throw new SubmissionError(GENERIC_ERROR);
    try {
      cachedKey = parseFormKey(await res.json());
    } catch {
      throw new SubmissionError(GENERIC_ERROR);
    }
    return cachedKey;
  }

  async function send(form: SubmissionForm, turnstileToken: string, honeypot: string, forceKey: boolean) {
    const key = await loadKey(forceKey);
    const plaintext: SubmissionPlaintext = {
      v: 1,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      kind: 'submission',
      site: host().toLowerCase(),
      form,
    };
    const { request, ref } = buildSubmitRequest(plaintext, key, turnstileToken, honeypot);
    let res: Response;
    try {
      res = await doFetch(SUBMIT_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request),
      });
    } catch {
      throw new SubmissionError(NETWORK_ERROR);
    }
    const body = (await res.json().catch(() => null)) as { ref?: unknown; error?: unknown } | null;
    return { res, body, ref };
  }

  return {
    turnstileSiteKey,
    async submit(form, turnstileToken, honeypot) {
      let attempt = await send(form, turnstileToken, honeypot, false);
      if (attempt.res.status === 409 && attempt.body?.error === 'stale_key') {
        attempt = await send(form, turnstileToken, honeypot, true);
      }
      const { res, body, ref } = attempt;
      if (res.status === 202) {
        return { ref: typeof body?.ref === 'string' && REF_RE.test(body.ref) ? body.ref : ref };
      }
      throw new SubmissionError(SUBMIT_ERROR_MESSAGES[res.status] ?? GENERIC_ERROR);
    },
  };
}

// Schemat zgłoszenia z formularza strony posła - jedno źródło prawdy dla:
//   - formularza w przeglądarce (walidacja przed zaszyfrowaniem, src/lib/publicSubmission.ts),
//   - legatto-intake process (walidacja po odszyfrowaniu, server/intake),
//   - funkcji SQL intake.submit_public_case (te same limity, obrona w głąb).
// Limity pól = dawna funkcja public-submit-case. Reguły „czysty tekst”: NFC, bez znaków
// sterujących C0/C1 (w opisie dozwolone \n i \t), bez znaków kierunku tekstu (U+202A–202E,
// U+2066–2069), bez BOM i bez niesparowanych surogatów.

import { z } from 'zod';

// eslint-disable-next-line no-control-regex
const CONTROL_SINGLE_LINE = /[\u0000-\u001f\u007f-\u009f]/;
// eslint-disable-next-line no-control-regex
const CONTROL_MULTI_LINE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
const BIDI_BOM = /[\u202a-\u202e\u2066-\u2069\ufeff]/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^[+\d\s()-]{6,20}$/;

/** Powód odrzucenia tekstu albo null, gdy tekst jest „czysty”. */
export function plainTextProblem(value: string, multiline: boolean): string | null {
  if (LONE_SURROGATE.test(value)) return 'Tekst zawiera niepoprawne znaki';
  if ((multiline ? CONTROL_MULTI_LINE : CONTROL_SINGLE_LINE).test(value)) {
    return multiline ? 'Tekst zawiera niedozwolone znaki sterujące' : 'Pole nie może zawierać znaków nowej linii ani sterujących';
  }
  if (BIDI_BOM.test(value)) return 'Tekst zawiera niedozwolone znaki kierunku tekstu';
  return null;
}

/** Tekst po trim + NFC, z regułami „czysty tekst” i limitami długości. */
export function plainText(min: number, max: number, multiline: boolean, messages: { min: string; max: string }) {
  return z
    .string()
    .transform((v) => v.trim().normalize('NFC'))
    .superRefine((v, ctx) => {
      const problem = plainTextProblem(v, multiline);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    })
    .pipe(z.string().min(min, messages.min).max(max, messages.max));
}

const id = (message: string) => z.number({ error: message }).int(message).positive(message).max(999_999_999, message);

/** Formularz w postaci kanonicznej (to, co trafia do plaintextu koperty). */
export const submissionFormSchema = z
  .object({
    reporter_name: plainText(3, 100, false, {
      min: 'Imię i nazwisko musi mieć min. 3 znaki',
      max: 'Imię i nazwisko za długie (max 100 znaków)',
    }),
    reporter_email: z
      .string()
      .trim()
      .max(254, 'E-mail za długi')
      .regex(EMAIL_RE, 'Nieprawidłowy adres e-mail')
      .nullable(),
    reporter_phone: z
      .string()
      .trim()
      .regex(PHONE_RE, 'Nieprawidłowy numer telefonu (6-20 znaków: cyfry, spacje, +, -, nawiasy)')
      .nullable(),
    powiat_id: id('Wybierz powiat'),
    gmina_id: id('Nieprawidłowa gmina').nullable(),
    category_id: id('Wybierz kategorię'),
    title: plainText(5, 200, false, { min: 'Tytuł musi mieć min. 5 znaków', max: 'Tytuł za długi (max 200 znaków)' }),
    description: plainText(20, 5000, true, {
      min: 'Opis musi mieć min. 20 znaków',
      max: 'Opis za długi (max 5000 znaków)',
    }),
    rodo_consent: z.literal(true, { error: 'Wymagana zgoda RODO' }),
    consent_newsletter: z.boolean(),
    consent_contacts_db: z.boolean(),
  })
  .strict()
  .refine((v) => v.reporter_email !== null || v.reporter_phone !== null, {
    message: 'Podaj e-mail lub telefon kontaktowy',
    path: ['reporter_email'],
  });

export type SubmissionForm = z.infer<typeof submissionFormSchema>;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SITE_HOST = /^[a-z0-9.-]{1,253}(:[0-9]{1,5})?$/;

/** Plaintext koperty (JSON w szyfrogramie z przeglądarki albo z legatto-intake selftest). */
export const plaintextSchema = z.discriminatedUnion('kind', [
  z
    .object({
      v: z.literal(1),
      id: z.string().regex(UUID_V4),
      ts: z.iso.datetime({ offset: true }),
      kind: z.literal('submission'),
      site: z.string().regex(SITE_HOST),
      form: submissionFormSchema,
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      id: z.string().regex(UUID_V4),
      ts: z.iso.datetime({ offset: true }),
      kind: z.literal('selftest'),
      site: z.string().regex(SITE_HOST),
      form: z.null(),
      marker: z.string().regex(/^[0-9a-f]{32}$/),
      mode: z.enum(['ping', 'verify']),
    })
    .strict(),
]);

export type SubmissionPlaintext = z.infer<typeof plaintextSchema>;

/**
 * Ramka plaintextu bez walidacji treści formularza. Biuro odróżnia kopertę uszkodzoną
 * (zła ramka = kwarantanna) od poprawnej koperty z niepoprawną treścią (odrzucenie
 * walidacyjne z pokwitowaniem, żeby ponowne doręczenie było duplikatem).
 */
export const plaintextEnvelopeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      v: z.literal(1),
      id: z.string().regex(UUID_V4),
      ts: z.string().max(40),
      kind: z.literal('submission'),
      site: z.string().max(260),
      form: z.unknown(),
    })
    .strict(),
  plaintextSchema.options[1],
]);

export type PlaintextEnvelope = z.infer<typeof plaintextEnvelopeSchema>;

/** Metadane dopisywane przez Workera (zaszyfrowane osobnym sealed boxem). */
export const metaSchema = z
  .object({
    v: z.literal(1),
    ip_hash: z.string().regex(/^[0-9a-f]{64}$/),
    ua: z.string().max(256),
    turnstile_ts: z.iso.datetime({ offset: true }).nullable(),
    release: z.string().max(64),
  })
  .strict();

export type EnvelopeMeta = z.infer<typeof metaSchema>;

/** Klucz publiczny formularza publikowany na stronie (/data/form-key.json). */
export const formKeySchema = z
  .object({
    v: z.literal(1),
    kid: z.string().regex(/^[0-9a-f]{16}$/),
    x25519: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  })
  .strict();

export type FormKey = z.infer<typeof formKeySchema>;

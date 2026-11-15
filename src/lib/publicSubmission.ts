import { z } from 'zod';

export const publicSubmissionSchema = z
  .object({
    reporter_name: z
      .string()
      .trim()
      .min(3, 'Imię i nazwisko musi mieć min. 3 znaki')
      .max(100, 'Imię i nazwisko za długie'),
    reporter_email: z
      .string()
      .trim()
      .email('Nieprawidłowy adres e-mail')
      .max(254, 'E-mail za długi')
      .optional()
      .or(z.literal('')),
    reporter_phone: z
      .string()
      .trim()
      .min(6, 'Telefon za krótki')
      .max(20, 'Telefon za długi')
      // Zgodnie z walidacja public-submit-case: cyfry, spacje, +, -, nawiasy.
      .regex(/^[+\d\s()-]+$/, 'Telefon może zawierać tylko cyfry, spacje oraz znaki + - ( )')
      .optional()
      .or(z.literal('')),
    powiat_id: z.coerce
      .number({ error: 'Wybierz powiat' })
      .int()
      .positive('Wybierz powiat'),
    gmina_id: z.coerce.number().int().positive().nullable().optional(),
    category_id: z.coerce
      .number({ error: 'Wybierz kategorię' })
      .int()
      .positive('Wybierz kategorię'),
    title: z
      .string()
      .trim()
      .min(5, 'Tytuł musi mieć min. 5 znaków')
      .max(200, 'Tytuł za długi'),
    description: z
      .string()
      .trim()
      .min(20, 'Opis musi mieć min. 20 znaków')
      .max(5000, 'Opis za długi (max 5000 znaków)'),
    rodo_consent: z.literal(true, { error: 'Wymagana zgoda RODO' }),
    // Opcjonalne zgody marketingowe (default false)
    consent_newsletter: z.boolean().default(false),
    consent_contacts_db: z.boolean().default(false),
    // honeypot
    website: z.string().optional(),
  })
  .refine(
    (v) => (v.reporter_email && v.reporter_email.length > 0) || (v.reporter_phone && v.reporter_phone.length > 0),
    { message: 'Podaj e-mail lub telefon kontaktowy', path: ['reporter_email'] },
  );

export type PublicSubmissionInput = z.infer<typeof publicSubmissionSchema>;

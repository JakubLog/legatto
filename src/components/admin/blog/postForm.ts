import { z } from 'zod';

// Formularz wpisu bloga - te same limity co CHECK-i tabeli public.posts
// (migracja 20261121210000_posts.sql), żeby błąd pokazał się przy polu, a nie jako błąd bazy.

export const POST_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
export const POST_SLUG_MAX = 80;
export const POST_TITLE_MAX = 200;
export const POST_EXCERPT_MAX = 500;
export const POST_BODY_MAX_BYTES = 200_000;

export const POST_STATUSES = ['draft', 'published', 'archived'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Szkic',
  published: 'Opublikowany',
  archived: 'Zarchiwizowany',
};

export const POST_STATUS_TONE: Record<PostStatus, 'neutral' | 'success' | 'warning'> = {
  draft: 'neutral',
  published: 'success',
  archived: 'warning',
};

// Litery, których NFKD nie rozkłada na literę bazową + znak diakrytyczny.
const TRANSLITERATION: Record<string, string> = { ł: 'l', ß: 'ss', æ: 'ae', ø: 'o', œ: 'oe', đ: 'd', þ: 'th' };

/** Podpowiedź adresu wpisu z tytułu: „Spotkanie w Łodzi – relacja” → „spotkanie-w-lodzi-relacja”. */
export function slugify(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[łßæøœđþ]/g, (ch) => TRANSLITERATION[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  return ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, POST_SLUG_MAX)
    .replace(/-+$/, '');
}

export const postFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Podaj tytuł')
      .max(POST_TITLE_MAX, `Tytuł może mieć najwyżej ${POST_TITLE_MAX} znaków`),
    slug: z
      .string()
      .trim()
      .min(1, 'Podaj adres wpisu')
      .regex(POST_SLUG_RE, 'Tylko małe litery bez polskich znaków, cyfry i myślniki (bez myślnika na początku i końcu), do 80 znaków'),
    excerpt: z.string().trim().max(POST_EXCERPT_MAX, `Zajawka może mieć najwyżej ${POST_EXCERPT_MAX} znaków`),
    body_md: z
      .string()
      .refine(
        (v) => new TextEncoder().encode(v).length <= POST_BODY_MAX_BYTES,
        'Treść jest za długa (limit ok. 200 tys. znaków)',
      ),
    cover_path: z.string(),
    status: z.enum(POST_STATUSES),
    /** Wartość pola datetime-local (czas lokalny) albo '' = data pierwszej publikacji. */
    published_at: z.string(),
  })
  .refine((v) => v.published_at === '' || !Number.isNaN(new Date(v.published_at).getTime()), {
    path: ['published_at'],
    message: 'Nieprawidłowa data',
  });

export type PostFormValues = z.infer<typeof postFormSchema>;

/** ISO z bazy → wartość pola datetime-local (czas lokalny przeglądarki). */
export function toDateTimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Wartość pola datetime-local → ISO (UTC) albo null. */
export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

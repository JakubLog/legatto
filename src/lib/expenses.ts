import { addMonths, endOfMonth, format, parse, startOfMonth } from 'date-fns';
import { pl } from 'date-fns/locale';
import { z } from 'zod';
import type { PaymentMethod } from '@/integrations/supabase/types';

/**
 * Miesieczny limit budzetowy biura zyje w `app_settings.budget_settings`
 * (`{ monthly_limit_pln }`, edycja: Posel/Administrator, hook `useBudgetSettings`).
 * Wszystkie kalkulacje wykorzystania liczone sa na podstawie sumy `office_expenses.amount`
 * w obrebie miesiaca kalendarzowego (`expense_date`).
 *
 * Wartosc domyslna (seed migracji 20261107100000) - uzywana tylko, gdy wiersza brak
 * albo jest niepoprawny. Ryczalt na biuro poselskie ustala Kancelaria Sejmu i zmienia
 * sie w czasie - to nie jest stala ustawowa, tylko punkt startowy instancji.
 */
export const DEFAULT_MONTHLY_LIMIT_PLN = 25_000;
export const MAX_MONTHLY_LIMIT_PLN = 1_000_000;

/** Ksztalt `app_settings.budget_settings` (= constraint app_settings_budget_settings_valid). */
export const budgetSettingsSchema = z.object({
  monthly_limit_pln: z
    .number({ error: 'Podaj kwotę limitu' })
    .int('Limit musi być liczbą całkowitą (pełne złote)')
    .positive('Limit musi być większy od zera')
    .max(MAX_MONTHLY_LIMIT_PLN, 'Limit nie może przekraczać 1 000 000 zł'),
});
export type BudgetSettings = z.infer<typeof budgetSettingsSchema>;

export const DEFAULT_BUDGET_SETTINGS: BudgetSettings = { monthly_limit_pln: DEFAULT_MONTHLY_LIMIT_PLN };

/** Wartosc z bazy -> ustawienia; brak/niepoprawny ksztalt = wartosc domyslna. */
export function parseBudgetSettings(value: unknown): BudgetSettings {
  const parsed = budgetSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_BUDGET_SETTINGS;
}

export const PAYMENT_METHODS: PaymentMethod[] = ['przelew', 'karta', 'gotowka', 'inne'];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  przelew: 'Przelew',
  karta: 'Karta',
  gotowka: 'Gotówka',
  inne: 'Inne',
};

const PLN_FORMATTER = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPLN(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '-';
  const num = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(num)) return '-';
  return PLN_FORMATTER.format(num);
}

const PERCENT_1_FORMATTER = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Procent z jednym miejscem po przecinku w polskim zapisie ("16,7%"), bez mnożenia przez 100. */
export function formatPercent1(percent: number): string {
  return `${PERCENT_1_FORMATTER.format(percent)}%`;
}

export function slugifyExpenseCategory(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

const RECEIPT_FILE_SLUG_RE = /[^a-zA-Z0-9.-]+/g;

export function slugifyReceiptFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  const cleanBase = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(RECEIPT_FILE_SLUG_RE, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'receipt';
  const cleanExt = ext.toLowerCase().replace(RECEIPT_FILE_SLUG_RE, '');
  return `${cleanBase}${cleanExt}`;
}

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const RECEIPT_ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type ReceiptMime = (typeof RECEIPT_ALLOWED_MIME)[number];

export function isAllowedReceiptMime(mime: string): mime is ReceiptMime {
  return (RECEIPT_ALLOWED_MIME as readonly string[]).includes(mime);
}

export function isReceiptPdf(mime: string | null | undefined): boolean {
  return mime === 'application/pdf';
}

// ============================================================================
// Helpery miesieczne (koszyk = miesiac kalendarzowy)
// ============================================================================

const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Aktualny miesiac w formacie 'YYYY-MM' (lokalna strefa). */
export function currentMonthIso(): string {
  return format(new Date(), 'yyyy-MM');
}

/** Parsuje 'YYYY-MM' do Date (1. dnia miesiaca). Wyrzuca jesli format zly. */
export function parseYearMonth(yearMonth: string): Date {
  if (!YEAR_MONTH_RE.test(yearMonth)) {
    throw new Error(`Invalid yearMonth: ${yearMonth}`);
  }
  return parse(yearMonth, 'yyyy-MM', new Date());
}

/** Zakres ISO dla 'YYYY-MM' - od 1. do ostatniego dnia. */
export function monthRangeIso(yearMonth: string): { from: string; to: string } {
  const d = parseYearMonth(yearMonth);
  return {
    from: format(startOfMonth(d), 'yyyy-MM-dd'),
    to: format(endOfMonth(d), 'yyyy-MM-dd'),
  };
}

/** Etykieta po polsku, np. "maj 2026". */
export function formatMonthLabel(yearMonth: string): string {
  return format(parseYearMonth(yearMonth), 'LLLL yyyy', { locale: pl });
}

/** Przesun miesiac o n (ujemne = wstecz). */
export function shiftMonth(yearMonth: string, n: number): string {
  return format(addMonths(parseYearMonth(yearMonth), n), 'yyyy-MM');
}

/** Obecny rok jako 'YYYY' (do liczenia rok-do-daty). */
export function currentYearIso(): string {
  return format(new Date(), 'yyyy');
}

/** Procentowe zuzycie budzetu (dopuszcza > 100 dla over-budget). `budget` = limit z `useMonthlyBudgetLimit`. */
export function budgetUsagePercent(spent: number, budget: number): number {
  if (budget <= 0) return 0;
  return (spent / budget) * 100;
}

// ============================================================================
// Mapy stylow (pelne literaly klas - wymagane przez Tailwind JIT)
// ============================================================================

export interface ExpenseCategoryClasses {
  /** Kropka koloru kategorii. */
  dot: string;
  /** Tlo + tekst pigulki kategorii. */
  pill: string;
}

const DEFAULT_CATEGORY_CLASSES: ExpenseCategoryClasses = {
  dot: 'bg-muted-foreground/60',
  pill: 'bg-muted text-muted-foreground',
};

/** Klucze = wartosci `expense_categories.color` (seed + kategorie uzytkownikow). */
const CATEGORY_COLOR_CLASSES: Record<string, ExpenseCategoryClasses> = {
  orange: { dot: 'bg-orange-500', pill: 'bg-orange-500/10 text-orange-700 dark:text-orange-300' },
  blue: { dot: 'bg-blue-500', pill: 'bg-blue-500/10 text-blue-700 dark:text-blue-300' },
  cyan: { dot: 'bg-cyan-500', pill: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300' },
  purple: { dot: 'bg-violet-500', pill: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  yellow: { dot: 'bg-yellow-500', pill: 'bg-yellow-500/15 text-yellow-800 dark:text-yellow-300' },
  teal: { dot: 'bg-teal-500', pill: 'bg-teal-500/10 text-teal-700 dark:text-teal-300' },
  red: { dot: 'bg-red-500', pill: 'bg-red-500/10 text-red-700 dark:text-red-300' },
  green: { dot: 'bg-emerald-500', pill: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  gray: DEFAULT_CATEGORY_CLASSES,
};

export function expenseCategoryClasses(color: string | null | undefined): ExpenseCategoryClasses {
  return (color && CATEGORY_COLOR_CLASSES[color]) || DEFAULT_CATEGORY_CLASSES;
}

export type BudgetLevel = 'ok' | 'warning' | 'critical' | 'over';

/** Poziom wykorzystania koszyka: < 60% ok, >= 60% ostrzezenie, >= 85% krytyczny, > limitu przekroczony. */
export function budgetLevel(spent: number, budget: number): BudgetLevel {
  if (spent > budget) return 'over';
  const percent = budgetUsagePercent(spent, budget);
  if (percent >= 85) return 'critical';
  if (percent >= 60) return 'warning';
  return 'ok';
}

export const BUDGET_LEVEL_CLASSES: Record<BudgetLevel, { bar: string; text: string; soft: string }> = {
  ok: {
    bar: 'bg-emerald-500',
    text: 'text-foreground',
    soft: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    bar: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    soft: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  critical: {
    bar: 'bg-orange-500',
    text: 'text-orange-600 dark:text-orange-400',
    soft: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  },
  over: {
    bar: 'bg-destructive',
    text: 'text-destructive',
    soft: 'bg-destructive/10 text-destructive',
  },
};

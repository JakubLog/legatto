import type { CasePriority, CaseStatus } from '@/integrations/supabase/types';

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  nowa: 'Nowa',
  w_toku: 'W toku',
  oczekuje: 'Oczekuje',
  załatwiona: 'Załatwiona',
  odrzucona: 'Odrzucona',
};

export const CASE_STATUSES: CaseStatus[] = ['nowa', 'w_toku', 'oczekuje', 'załatwiona', 'odrzucona'];

/** Statusy spraw w toku (bez załatwionych i odrzuconych) - domyślny filtr listy. */
export const OPEN_CASE_STATUSES: CaseStatus[] = CASE_STATUSES.filter((s) => !isCaseResolved(s));

export const CASE_PRIORITY_LABELS: Record<CasePriority, string> = {
  low: 'Niski',
  normal: 'Normalny',
  high: 'Wysoki',
  urgent: 'Pilny',
};

export const CASE_PRIORITIES: CasePriority[] = ['low', 'normal', 'high', 'urgent'];

/** Opcje filtra statusu (pigułka i nagłówek kolumny); `open` = bez załatwionych i odrzuconych. */
export const CASE_STATUS_FILTER_OPTIONS = [
  { value: 'open', label: 'Otwarte' },
  ...CASE_STATUSES.map((s) => ({ value: s, label: CASE_STATUS_LABELS[s] })),
];

export const CASE_PRIORITY_FILTER_OPTIONS = CASE_PRIORITIES.map((p) => ({ value: p, label: CASE_PRIORITY_LABELS[p] }));

export const CASE_PRIORITY_CLASSNAME: Record<CasePriority, string> = {
  low: 'text-muted-foreground',
  normal: 'text-foreground',
  high: 'text-orange-600 dark:text-orange-400 font-medium',
  urgent: 'text-red-600 dark:text-red-400 font-semibold',
};

/** Kolor kropki statusu (lista, nagłówki grup, szczegóły). */
export const CASE_STATUS_DOT: Record<CaseStatus, string> = {
  nowa: 'bg-sky-500',
  w_toku: 'bg-primary',
  oczekuje: 'bg-amber-500',
  załatwiona: 'bg-emerald-500',
  odrzucona: 'bg-muted-foreground/60',
};

/** Pill statusu: delikatne tło + kolorowy tekst (działa w trybie jasnym i ciemnym). */
export const CASE_STATUS_PILL: Record<CaseStatus, string> = {
  nowa: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  w_toku: 'bg-primary/10 text-primary dark:bg-primary/20',
  oczekuje: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  załatwiona: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  odrzucona: 'bg-muted text-muted-foreground',
};

/** Kolor ikony flagi priorytetu. */
export const CASE_PRIORITY_FLAG: Record<CasePriority, string> = {
  low: 'text-muted-foreground/50',
  normal: 'text-sky-500',
  high: 'text-amber-500',
  urgent: 'text-destructive',
};

export function isCaseResolved(status: CaseStatus): boolean {
  return status === 'załatwiona' || status === 'odrzucona';
}

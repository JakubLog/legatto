import type { InterpellationStatus } from '@/integrations/supabase/types';

export const INTERPELLATION_STATUS_LABELS: Record<InterpellationStatus, string> = {
  nowa: 'Nowa',
  uwagi: 'Uwagi',
  po_poprawkach: 'Po poprawkach',
  zaakceptowana: 'Zaakceptowana, czeka na wysłanie',
  wyslana: 'Interpelacja wysłana',
  odrzucona: 'Odrzucona (archiwum)',
};

/** Krótka etykieta do ciasnych miejsc (pigułka na liście, zakładki). */
export const INTERPELLATION_STATUS_SHORT: Record<InterpellationStatus, string> = {
  nowa: 'Nowa',
  uwagi: 'Uwagi',
  po_poprawkach: 'Po poprawkach',
  zaakceptowana: 'Do wysłania',
  wyslana: 'Wysłana',
  odrzucona: 'Odrzucona',
};

/** Kolejność etapów obiegu (zakładki, zestawienia). */
export const INTERPELLATION_STATUSES: InterpellationStatus[] = [
  'nowa',
  'po_poprawkach',
  'uwagi',
  'zaakceptowana',
  'wyslana',
  'odrzucona',
];

/** Statusy czekające na decyzję Posła. */
export const AWAITING_DECISION: readonly InterpellationStatus[] = ['nowa', 'po_poprawkach'];

/** Statusy kończące obieg (wysłana albo archiwum). */
export const TERMINAL_STATUSES: readonly InterpellationStatus[] = ['wyslana', 'odrzucona'];

export const isAwaitingDecision = (s: InterpellationStatus) => AWAITING_DECISION.includes(s);
export const isTerminal = (s: InterpellationStatus) => TERMINAL_STATUSES.includes(s);

/** Widoki strony interpelacji. */
export type InterpellationsLayout = 'list' | 'board' | 'calendar';
export const INTERPELLATION_LAYOUTS: readonly InterpellationsLayout[] = ['list', 'board', 'calendar'];

/** Kolor kropki statusu. */
export const INTERPELLATION_STATUS_DOT: Record<InterpellationStatus, string> = {
  nowa: 'bg-sky-500',
  uwagi: 'bg-amber-500',
  po_poprawkach: 'bg-violet-500',
  zaakceptowana: 'bg-brand',
  wyslana: 'bg-emerald-500',
  odrzucona: 'bg-muted-foreground/60',
};

/** Tło i kolor tekstu "pigułki" statusu; warianty dark trzymają kontrast. */
export const INTERPELLATION_STATUS_PILL: Record<InterpellationStatus, string> = {
  nowa: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  uwagi: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  po_poprawkach: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
  zaakceptowana: 'bg-brand/10 text-brand',
  wyslana: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  odrzucona: 'bg-muted text-muted-foreground',
};

export type DeadlineState = 'overdue' | 'soon' | 'ok';

/** Stan terminu wysłania: po terminie, mniej niż 6 h do terminu, albo w normie. */
export function deadlineState(deadlineAt: string, now: Date = new Date()): DeadlineState {
  const left = new Date(deadlineAt).getTime() - now.getTime();
  if (left <= 0) return 'overdue';
  if (left <= 6 * 60 * 60 * 1000) return 'soon';
  return 'ok';
}

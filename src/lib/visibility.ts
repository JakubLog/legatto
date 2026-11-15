import { formatDistanceToNow } from 'date-fns';
import { pl } from 'date-fns/locale';

export type VisibilityStatus = 'green' | 'yellow' | 'red' | 'unknown';

export const VISIBILITY_LABELS: Record<VisibilityStatus, string> = {
  green: 'Aktywny',
  yellow: 'Uwaga',
  red: 'Brak obecności',
  unknown: 'Brak danych',
};

export const VISIBILITY_HEX: Record<VisibilityStatus, string> = {
  green: '#16a34a', // green-600
  yellow: '#eab308', // yellow-500
  red: '#dc2626', // red-600
  unknown: '#94a3b8', // slate-400
};

export const VISIBILITY_BADGE_CLASS: Record<VisibilityStatus, string> = {
  green: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  yellow: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  red: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  unknown: 'bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-200',
};

export function visibilityStatus(daysSince: number | null, thresholdDays: number): VisibilityStatus {
  if (thresholdDays <= 0) return 'unknown';
  if (daysSince === null) return 'red';
  if (daysSince > thresholdDays) return 'red';
  if (daysSince > thresholdDays / 2) return 'yellow';
  return 'green';
}

export function lastEventLabel(lastEventAt: string | null): string {
  if (!lastEventAt) return 'Nigdy';
  return `${formatDistanceToNow(new Date(lastEventAt), { locale: pl, addSuffix: true })}`;
}

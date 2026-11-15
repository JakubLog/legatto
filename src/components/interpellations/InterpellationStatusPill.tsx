import { cn } from '@/lib/utils';
import {
  INTERPELLATION_STATUS_DOT,
  INTERPELLATION_STATUS_LABELS,
  INTERPELLATION_STATUS_PILL,
  INTERPELLATION_STATUS_SHORT,
} from '@/lib/interpellations';
import type { InterpellationStatus } from '@/integrations/supabase/types';

interface Props {
  status: InterpellationStatus;
  /** Pełna etykieta zamiast krótkiej (np. nagłówek szczegółów). */
  full?: boolean;
  className?: string;
}

export function InterpellationStatusPill({ status, full = false, className }: Props) {
  return (
    <span
      title={INTERPELLATION_STATUS_LABELS[status]}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        INTERPELLATION_STATUS_PILL[status],
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', INTERPELLATION_STATUS_DOT[status])} aria-hidden />
      {full ? INTERPELLATION_STATUS_LABELS[status] : INTERPELLATION_STATUS_SHORT[status]}
    </span>
  );
}

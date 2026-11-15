import { VISIBILITY_BADGE_CLASS, VISIBILITY_HEX, VISIBILITY_LABELS, type VisibilityStatus } from '@/lib/visibility';
import { cn } from '@/lib/utils';

export const VISIBILITY_ORDER: VisibilityStatus[] = ['green', 'yellow', 'red', 'unknown'];

/** Kolorowa kropka statusu – ten sam kolor co wypełnienie powiatu na mapie. */
export function VisibilityDot({ status, className }: { status: VisibilityStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: VISIBILITY_HEX[status] }}
    />
  );
}

interface PillProps {
  status: VisibilityStatus;
  /** Opcjonalny licznik wyświetlany po etykiecie (np. w podsumowaniu). */
  count?: number;
  className?: string;
}

/** Pigułka statusu: kropka + etykieta (+ licznik). */
export function VisibilityStatusPill({ status, count, className }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        VISIBILITY_BADGE_CLASS[status],
        className,
      )}
    >
      <VisibilityDot status={status} />
      {VISIBILITY_LABELS[status]}
      {count !== undefined && <span className="tabular-nums opacity-70">{count}</span>}
    </span>
  );
}

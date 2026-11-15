import { EVENT_TYPE_DOT, EVENT_TYPE_LABELS, EVENT_TYPE_PILL } from '@/lib/events';
import type { EventType } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';

interface Props {
  type: EventType;
  className?: string;
}

/** Typ wydarzenia jako miękka pigułka z kolorową kropką. */
export function EventTypePill({ type, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4',
        EVENT_TYPE_PILL[type],
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', EVENT_TYPE_DOT[type])} aria-hidden />
      {EVENT_TYPE_LABELS[type]}
    </span>
  );
}

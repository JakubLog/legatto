import { Flag } from 'lucide-react';
import {
  CASE_PRIORITY_FLAG,
  CASE_PRIORITY_LABELS,
  CASE_STATUS_DOT,
  CASE_STATUS_LABELS,
  CASE_STATUS_PILL,
} from '@/lib/cases';
import type { CasePriority, CaseStatus } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';

export function CaseStatusDot({ status, className }: { status: CaseStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', CASE_STATUS_DOT[status], className)}
    />
  );
}

export function CaseStatusPill({ status, className }: { status: CaseStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        CASE_STATUS_PILL[status],
        className,
      )}
    >
      <CaseStatusDot status={status} className="h-1.5 w-1.5" />
      {CASE_STATUS_LABELS[status]}
    </span>
  );
}

interface PriorityProps {
  priority: CasePriority;
  showLabel?: boolean;
  className?: string;
}

export function CasePriorityFlag({ priority, showLabel = false, className }: PriorityProps) {
  const label = CASE_PRIORITY_LABELS[priority];
  return (
    <span
      className={cn('inline-flex items-center gap-1 whitespace-nowrap text-xs', className)}
      title={`Priorytet: ${label}`}
    >
      <Flag
        className={cn('h-3.5 w-3.5 shrink-0', CASE_PRIORITY_FLAG[priority], priority !== 'low' && 'fill-current')}
        aria-hidden
      />
      {showLabel ? <span>{label}</span> : <span className="sr-only">Priorytet: {label}</span>}
    </span>
  );
}

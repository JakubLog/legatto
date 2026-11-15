import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deadlineState } from '@/lib/interpellations';
import { DEADLINE_TEXT, deadlineLabel } from '@/components/interpellations/urgency';

interface Props {
  deadlineAt: string;
  className?: string;
}

/** Termin wysłania zaakceptowanej interpelacji, kolorowany wg stanu (po terminie / blisko). */
export function InterpellationDeadline({ deadlineAt, className }: Props) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const state = deadlineState(deadlineAt, now);
  return (
    <span
      title={`Termin wysłania: ${format(new Date(deadlineAt), 'd MMMM yyyy, HH:mm', { locale: pl })}`}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap text-xs',
        DEADLINE_TEXT[state],
        state !== 'ok' && 'font-medium',
        className,
      )}
    >
      <Clock className="h-3 w-3 shrink-0" aria-hidden />
      {deadlineLabel(deadlineAt, now)}
    </span>
  );
}

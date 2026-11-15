import { format, isToday } from 'date-fns';
import { pl } from 'date-fns/locale';
import { CalendarX2, MapPin, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EVENT_TYPE_DOT, eventOnDay } from '@/lib/events';
import type { CalendarEventWithRelations } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { canWrite } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { EventTypePill } from './EventTypePill';
import { formatEventTime, pluralizeEvents } from './eventFormat';

interface Props {
  day: Date | null;
  events: CalendarEventWithRelations[];
  onClose: () => void;
  onSelectEvent: (e: CalendarEventWithRelations) => void;
  onAdd: (day: Date) => void;
}

export function DayEventsDialog({ day, events, onClose, onSelectEvent, onAdd }: Props) {
  const { profile } = useAuth();
  const writer = canWrite(profile?.role);

  if (!day) return null;
  const dayEvents = events.filter((e) => eventOnDay(e.starts_at, e.ends_at, day));

  return (
    <Dialog open={Boolean(day)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-5 sm:max-w-lg">
        <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl leading-none',
              isToday(day) ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary',
            )}
            aria-hidden
          >
            <span className="text-[10px] font-medium">{format(day, 'LLL', { locale: pl })}</span>
            <span className="text-base font-semibold tabular-nums">{format(day, 'd')}</span>
          </div>
          <div className="min-w-0 space-y-1">
            <DialogTitle className="first-letter:uppercase">
              {format(day, 'EEEE, d MMMM yyyy', { locale: pl })}
            </DialogTitle>
            <DialogDescription>
              {dayEvents.length === 0 ? 'Brak wydarzeń tego dnia.' : pluralizeEvents(dayEvents.length)}
            </DialogDescription>
          </div>
        </DialogHeader>

        {dayEvents.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <CalendarX2 className="h-5 w-5" />
            </div>
            <p className="text-sm text-muted-foreground">Wolny dzień w kalendarzu.</p>
          </div>
        ) : (
          <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border">
            {dayEvents.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                  onClick={() => {
                    onSelectEvent(e);
                    onClose();
                  }}
                >
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', EVENT_TYPE_DOT[e.type])} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 break-words text-sm font-medium">{e.title}</span>
                    <span className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
                      <span className="shrink-0 tabular-nums">
                        {formatEventTime(e.starts_at, e.ends_at, e.all_day, day)}
                      </span>
                      {e.location && (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="truncate">{e.location}</span>
                        </span>
                      )}
                    </span>
                  </span>
                  <EventTypePill type={e.type} className="max-md:hidden" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {writer && (
          <Button
            variant={dayEvents.length === 0 ? 'default' : 'outline'}
            className="w-full"
            onClick={() => {
              onAdd(day);
              onClose();
            }}
          >
            <Plus />
            Dodaj wydarzenie tego dnia
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

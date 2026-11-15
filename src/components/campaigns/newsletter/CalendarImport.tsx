import { useState } from 'react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { CalendarPlus, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { usePublicUpcomingEvents } from '@/hooks/useEvents';
import type { PublicCalendarEvent } from '@/integrations/supabase/types';
import type { EventItem } from '@/lib/newsletter/types';
import { cn } from '@/lib/utils';

// ============================================================================
// "Wstaw z kalendarza" - publiczne nadchodzące wydarzenia biura -> pozycje sekcji Zapraszam.
// Tylko wydarzenia oznaczone jako publiczne (te same, co na stronie biura).
// ============================================================================

function toEventItem(e: PublicCalendarEvent): EventItem {
  const start = new Date(e.starts_at);
  const place = [e.location, e.gmina_name].filter(Boolean).join(', ');
  const time = e.all_day ? '' : `godz. ${format(start, 'HH:mm')}`;
  return {
    day: format(start, 'd'),
    month: format(start, 'LLL', { locale: pl }).toUpperCase().slice(0, 8),
    title: e.title.slice(0, 200),
    location: [place && `📍 ${place}`, time].filter(Boolean).join(' · ').slice(0, 200),
    detail: (e.description ?? '').split('\n')[0].trim().slice(0, 200),
  };
}

function EventPicker({ onImport, onClose }: { onImport: (items: EventItem[]) => void; onClose: () => void }) {
  const eventsQ = usePublicUpcomingEvents();
  const [picked, setPicked] = useState<Record<string, true>>({});
  const events = eventsQ.data ?? [];
  const pickedCount = Object.keys(picked).length;

  if (eventsQ.isLoading) {
    return (
      <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Ładuję kalendarz…
      </p>
    );
  }
  if (eventsQ.error) {
    return <p className="p-3 text-xs text-destructive">Nie udało się pobrać wydarzeń: {eventsQ.error.message}</p>;
  }
  if (events.length === 0) {
    return (
      <p className="p-3 text-xs text-muted-foreground">
        Brak nadchodzących wydarzeń publicznych. Oznacz wydarzenie w kalendarzu jako publiczne, aby je tu zobaczyć.
      </p>
    );
  }

  return (
    <div className="space-y-2 p-2">
      <ul className="max-h-60 space-y-1 overflow-y-auto">
        {events.map((e) => {
          const checked = picked[e.id] === true;
          return (
            <li key={e.id}>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/60',
                  checked && 'bg-primary/5',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = { ...prev };
                      if (checked) delete next[e.id];
                      else next[e.id] = true;
                      return next;
                    })
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="w-16 shrink-0 text-xs font-semibold uppercase text-muted-foreground">
                  {format(new Date(e.starts_at), 'd LLL', { locale: pl })}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{e.title}</span>
                  {(e.location || e.gmina_name) && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {[e.location, e.gmina_name].filter(Boolean).join(', ')}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Anuluj
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={pickedCount === 0}
          onClick={() => {
            onImport(events.filter((e) => picked[e.id]).map(toEventItem));
            onClose();
          }}
        >
          Wstaw {pickedCount > 0 ? `(${pickedCount})` : ''}
        </Button>
      </div>
    </div>
  );
}

export function CalendarImport({ onImport }: { onImport: (items: EventItem[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted/40"
      >
        <CalendarPlus className="h-4 w-4" />
        Wstaw z kalendarza biura
        <span className="ml-auto text-xs font-normal text-muted-foreground">tylko wydarzenia publiczne</span>
      </button>
      {open && (
        <div className="border-t">
          <EventPicker onImport={onImport} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

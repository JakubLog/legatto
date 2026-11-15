import { Calendar, CalendarPlus, ChevronRight, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { UpcomingEvent } from '@/hooks/useDashboardStats';
import { EVENT_TYPE_DOT, EVENT_TYPE_LABELS } from '@/lib/events';
import { cn } from '@/lib/utils';
import { DashboardSection, SectionEmpty, SectionRowsSkeleton } from '@/components/dashboard/DashboardSection';
import { formatEventDate, formatEventDateAllDay } from '@/components/dashboard/dashboardUtils';

interface UpcomingEventsCardProps {
  events: UpcomingEvent[];
  loading: boolean;
  className?: string;
}

/** Sekcja "Najbliższe wydarzenia": kompaktowe wiersze z kropką typu, tytułem i terminem. */
export function UpcomingEventsCard({ events, loading, className }: UpcomingEventsCardProps) {
  return (
    <DashboardSection
      title="Najbliższe wydarzenia"
      icon={Calendar}
      to="/biuro/kalendarz"
      className={className}
    >
      {loading ? (
        <SectionRowsSkeleton rows={5} />
      ) : events.length === 0 ? (
        <SectionEmpty
          icon={CalendarPlus}
          message="Brak zaplanowanych wydarzeń."
          actionLabel="Otwórz kalendarz"
          actionTo="/biuro/kalendarz"
        />
      ) : (
        <ul className="divide-y">
          {events.map((event) => (
            <li key={event.id}>
              <Link
                to={`/biuro/kalendarz?open=${event.id}`}
                className="group flex min-h-12 min-w-0 max-w-full items-center gap-3 overflow-hidden px-4 py-2.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
              >
                <span
                  aria-hidden
                  className={cn('h-2 w-2 shrink-0 rounded-full', EVENT_TYPE_DOT[event.type])}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{event.title}</p>
                  <p className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-hidden text-xs text-muted-foreground">
                    <span className="shrink-0 first-letter:uppercase">
                      {event.all_day
                        ? formatEventDateAllDay(event.starts_at)
                        : formatEventDate(event.starts_at)}
                    </span>
                    <span aria-hidden className="md:hidden">·</span>
                    <span className="shrink-0 md:hidden">{EVENT_TYPE_LABELS[event.type]}</span>
                    {event.location && (
                      // Telefon: lokalizacja w osobnej linii, bez wiszącej kropki na początku.
                      <span className="flex min-w-0 items-center gap-1 max-md:basis-full">
                        <span aria-hidden className="max-md:hidden">·</span>
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{event.location}</span>
                      </span>
                    )}
                  </p>
                </div>
                <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground md:inline">
                  {EVENT_TYPE_LABELS[event.type]}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 max-md:hidden" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardSection>
  );
}

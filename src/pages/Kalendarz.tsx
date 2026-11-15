import { useEffect, useMemo, useRef, useState } from 'react';
import { endOfMonth, startOfMonth } from 'date-fns';
import { Calendar, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Page, PageHeader } from '@/components/layout/Page';
import { ModuleOwners } from '@/components/common/ModuleOwners';
import { useAuth } from '@/contexts/AuthContext';
import { canWrite } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { CalendarViewTabs, MonthNav, type CalendarView } from '@/components/events/CalendarToolbar';
import { EventsFilters } from '@/components/events/EventsFilters';
import { EventsList } from '@/components/events/EventsList';
import { EventsMonthGrid } from '@/components/events/EventsMonthGrid';
import { EventFormDialog } from '@/components/events/EventFormDialog';
import { DeleteEventDialog } from '@/components/events/DeleteEventDialog';
import { DayEventsDialog } from '@/components/events/DayEventsDialog';
import { pluralizeEvents } from '@/components/events/eventFormat';
import { useEvent, useEvents, type EventsFilters as Filters } from '@/hooks/useEvents';
import { useOpenParam } from '@/hooks/useOpenParam';
import type { CalendarEventWithRelations } from '@/integrations/supabase/types';

const EMPTY_FILTERS: Filters = { type: null, assignedTo: null, search: '' };

export default function Kalendarz() {
  const { profile } = useAuth();
  const writer = canWrite(profile?.role);

  const [view, setView] = useState<CalendarView>('list');
  const [monthDate, setMonthDate] = useState<Date>(new Date());
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEventWithRelations | null>(null);
  const [defaultDate, setDefaultDate] = useState<Date | null>(null);
  const [deleting, setDeleting] = useState<CalendarEventWithRelations | null>(null);
  const [dayPopup, setDayPopup] = useState<Date | null>(null);

  // Dla widoku miesiąca pobieramy wycinek + bufor (siatka pokazuje tygodnie wcześniej/później)
  const monthFilters = useMemo<Filters>(() => {
    if (view !== 'month') return filters;
    const from = new Date(startOfMonth(monthDate));
    from.setDate(from.getDate() - 7);
    const to = new Date(endOfMonth(monthDate));
    to.setDate(to.getDate() + 7);
    return { ...filters, from: from.toISOString(), to: to.toISOString() };
  }, [view, filters, monthDate]);

  const { data: events = [], isLoading } = useEvents(monthFilters);
  const filtered = Boolean(filters.type || filters.assignedTo || (filters.search ?? '').trim());

  const handleAdd = (date?: Date) => {
    setEditing(null);
    setDefaultDate(date ?? null);
    setFormOpen(true);
  };

  const handleEdit = (e: CalendarEventWithRelations) => {
    setEditing(e);
    setDefaultDate(null);
    setFormOpen(true);
  };

  // Deep-link `?open=<id>` (wyszukiwarka globalna): otwiera to samo okno co kliknięcie wydarzenia.
  const [openId, clearOpen] = useOpenParam();
  const loadedMatch = openId ? (events.find((e) => e.id === openId) ?? null) : null;
  const byId = useEvent(openId && !isLoading && !loadedMatch ? openId : null);
  const handledOpenId = useRef<string | null>(null);

  useEffect(() => {
    if (!openId) {
      handledOpenId.current = null;
      return;
    }
    if (handledOpenId.current === openId || isLoading) return;
    const target = loadedMatch ?? byId.data;
    if (target) {
      handledOpenId.current = openId;
      setEditing(target);
      setDefaultDate(null);
      setFormOpen(true);
    } else if (byId.isError || byId.data === null) {
      handledOpenId.current = openId;
      toast.error('Nie znaleziono wydarzenia', { description: 'Mogło zostać usunięte lub nie masz do niego dostępu.' });
      clearOpen();
    }
  }, [openId, isLoading, loadedMatch, byId.data, byId.isError, clearOpen]);

  const handleFormOpenChange = (open: boolean) => {
    setFormOpen(open);
    if (!open && openId) clearOpen();
  };

  return (
    <Page>
      <PageHeader
        title="Kalendarz"
        titleAddon={<ModuleOwners module="kalendarz" />}
        description="Spotkania, wyjazdy, media i inne wydarzenia biura."
        icon={Calendar}
        actions={
          writer && (
            <Button onClick={() => handleAdd()}>
              <Plus />
              Dodaj wydarzenie
            </Button>
          )
        }
        toolbar={
          <>
            <CalendarViewTabs value={view} onChange={setView} />
            {/* Telefon: nawigacja miesiąca w osobnym, pełnym wierszu pod zakładkami. */}
            <div className={cn('ml-auto', view === 'month' && '@max-md:ml-0 @max-md:w-full')}>
              {view === 'month' ? (
                <MonthNav monthDate={monthDate} onChange={setMonthDate} />
              ) : (
                !isLoading && (
                  <span className="text-xs tabular-nums text-muted-foreground">{pluralizeEvents(events.length)}</span>
                )
              )}
            </div>
          </>
        }
      />

      <EventsFilters value={filters} onChange={setFilters} />

      {view === 'list' ? (
        <EventsList
          events={events}
          isLoading={isLoading}
          filtered={filtered}
          onEdit={handleEdit}
          onDelete={setDeleting}
          onAdd={writer ? () => handleAdd() : undefined}
        />
      ) : (
        <EventsMonthGrid
          monthDate={monthDate}
          events={events}
          isLoading={isLoading}
          onSelectDay={setDayPopup}
          onSelectEvent={handleEdit}
          onAddDay={writer ? handleAdd : undefined}
        />
      )}

      <EventFormDialog
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        event={editing}
        defaultDate={defaultDate}
      />
      <DeleteEventDialog event={deleting} onClose={() => setDeleting(null)} />
      <DayEventsDialog
        day={dayPopup}
        events={events}
        onClose={() => setDayPopup(null)}
        onSelectEvent={handleEdit}
        onAdd={handleAdd}
      />
    </Page>
  );
}

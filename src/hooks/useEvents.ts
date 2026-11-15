import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  CalendarEvent,
  CalendarEventWithRelations,
  EventType,
  PublicCalendarEvent,
} from '@/integrations/supabase/types';

export interface EventsFilters {
  type?: EventType | null;
  assignedTo?: string | null;
  search?: string;
  from?: string | null; // ISO datetime
  to?: string | null; // ISO datetime
}

const SELECT_WITH_RELATIONS = `
  id, title, description, type, starts_at, ends_at, all_day, location,
  powiat_id, gmina_id, case_id, contact_id, assigned_to,
  created_by, created_at, updated_at,
  case:cases(id, title, status),
  contact:contacts(id, first_name, last_name),
  powiat:powiaty(id, name),
  gmina:gminy(id, name),
  assigned:profiles!events_assigned_to_fkey(id, full_name, avatar_url)
`;

function escapeOrToken(input: string): string {
  return input.replace(/[\\,()]/g, '');
}

export function useEvents(filters: EventsFilters = {}) {
  return useQuery<CalendarEventWithRelations[]>({
    queryKey: [
      'events',
      filters.type ?? null,
      filters.assignedTo ?? null,
      (filters.search ?? '').trim().toLowerCase(),
      filters.from ?? null,
      filters.to ?? null,
    ],
    queryFn: async () => {
      let query = supabase
        .from('events')
        .select(SELECT_WITH_RELATIONS)
        .order('starts_at', { ascending: true })
        .limit(500);

      if (filters.type) query = query.eq('type', filters.type);
      if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
      if (filters.from) query = query.gte('starts_at', filters.from);
      if (filters.to) query = query.lte('starts_at', filters.to);
      const search = (filters.search ?? '').trim();
      if (search.length >= 2) {
        const term = `%${escapeOrToken(search)}%`;
        query = query.or(`title.ilike.${term},description.ilike.${term},location.ilike.${term}`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as CalendarEventWithRelations[];
    },
    staleTime: 30_000,
  });
}

/** Pojedyncze wydarzenie po id (deep-link `?open=<id>`). `null` = brak rekordu lub brak dostępu (RLS). */
export function useEvent(id: string | null) {
  return useQuery<CalendarEventWithRelations | null>({
    queryKey: ['events', 'detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select(SELECT_WITH_RELATIONS)
        .eq('id', id as string)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as CalendarEventWithRelations | null;
    },
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export type EventInput = Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at' | 'created_by'>;

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: EventInput) => {
      const { data, error } = await supabase
        .from('events')
        .insert(input)
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<EventInput> & { id: string }) => {
      const { error } = await supabase.from('events').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  });
}

// Publiczna lista nadchodzacych wydarzen (anon + authenticated) dla kalendarza na stronie
// glownej. 24 = maksimum zwracane przez RPC.
// Wymaga migracji 20260504100000_events_public_read.sql.
const PUBLIC_EVENTS_LIMIT = 24;

export function usePublicUpcomingEvents() {
  return useQuery<PublicCalendarEvent[]>({
    queryKey: ['public-upcoming-events', PUBLIC_EVENTS_LIMIT],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_public_upcoming_events', {
        p_limit: PUBLIC_EVENTS_LIMIT,
      });
      if (error) throw error;
      return (data ?? []) as PublicCalendarEvent[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('events').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  });
}

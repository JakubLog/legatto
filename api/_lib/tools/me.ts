import { getServiceClient } from '../supabase.js';
import { DbError } from '../log-safe.js';
import { type ToolDefinition, jsonResult, markCase, markEvent, optionalNumber, ToolValidationError } from './types.js';

const OPEN_CASE_STATUSES = ['nowa', 'w_toku', 'oczekuje'];

export const meTools: ToolDefinition[] = [
  {
    name: 'me_profile',
    title: 'Mój profil',
    readOnly: true,
    description:
      'Kim jestem w systemie: mój profil, rola, biuro, zespół mojego biura i mój zakres danych (scope own = tylko moje rekordy, all = wszystkie). Dobry punkt startowy rozmowy.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, ctx) => {
      const supabase = getServiceClient();
      const [profileRes, colleaguesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, email, phone, role, is_public, office:offices(id, name, city, address, phone, email)')
          .eq('id', ctx.userId)
          .single(),
        ctx.officeId
          ? supabase
              .from('profiles')
              .select('id, full_name, role, phone')
              .eq('office_id', ctx.officeId)
              .eq('is_active', true)
              .neq('id', ctx.userId)
              .order('full_name')
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (profileRes.error) throw new DbError(profileRes.error);
      if (colleaguesRes.error) throw new DbError(colleaguesRes.error);
      return jsonResult({
        profile: profileRes.data,
        data_scopes: ctx.dataScopes,
        office_colleagues: colleaguesRes.data ?? [],
      });
    },
  },

  {
    name: 'me_agenda',
    title: 'Moja agenda',
    readOnly: true,
    description:
      'Moja lista zadań: otwarte sprawy przypisane do mnie (z liczbą przeterminowanych), moje wydarzenia w kalendarzu na najbliższe dni i moje niewysłane interpelacje.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 60, default: 7, description: 'Horyzont kalendarza w dniach' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const days = optionalNumber(args, 'days') ?? 7;
      if (!Number.isInteger(days) || days < 1 || days > 60) {
        throw new ToolValidationError('Pole "days" musi być liczbą całkowitą 1-60.');
      }
      const now = new Date();
      const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      const today = now.toISOString().slice(0, 10);
      const supabase = getServiceClient();

      let interpellationsQuery = supabase
        .from('interpellations')
        .select('id, recipient, subject, status, revision, review_notes, submitted_at, deadline_at')
        .not('status', 'in', '(wyslana,odrzucona)')
        .order('submitted_at', { ascending: false })
        .limit(20);
      if (ctx.userRole === 'pracownik') {
        interpellationsQuery = interpellationsQuery.eq('created_by', ctx.userId);
      }

      const [casesRes, eventsRes, interpellationsRes] = await Promise.all([
        supabase
          .from('cases')
          .select('id, title, status, priority, source, due_date, updated_at')
          .eq('assigned_to', ctx.userId)
          .in('status', OPEN_CASE_STATUSES)
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(50),
        supabase
          .from('events')
          .select('id, title, type, starts_at, ends_at, all_day, location, ics_source_id')
          .or(`assigned_to.eq.${ctx.userId},created_by.eq.${ctx.userId}`)
          .gte('starts_at', now.toISOString())
          .lte('starts_at', until.toISOString())
          .order('starts_at', { ascending: true })
          .limit(50),
        interpellationsQuery,
      ]);
      if (casesRes.error) throw new DbError(casesRes.error);
      if (eventsRes.error) throw new DbError(eventsRes.error);
      if (interpellationsRes.error) throw new DbError(interpellationsRes.error);

      const cases = (casesRes.data ?? []).map(markCase);
      return jsonResult({
        today,
        open_cases: {
          count: cases.length,
          overdue: cases.filter((c) => c.due_date !== null && c.due_date < today).length,
          cases,
        },
        upcoming_events: { until: until.toISOString(), events: (eventsRes.data ?? []).map(markEvent) },
        open_interpellations: interpellationsRes.data ?? [],
      });
    },
  },
];

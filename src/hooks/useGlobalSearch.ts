import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  CalendarEvent,
  Case,
  Contact,
  Interpellation,
  OfficeExpense,
} from '@/integrations/supabase/types';
import { CASE_STATUS_LABELS } from '@/lib/cases';
import { EVENT_TYPE_LABELS } from '@/lib/events';
import { INTERPELLATION_STATUS_SHORT } from '@/lib/interpellations';

export type SearchResultType = 'case' | 'contact' | 'event' | 'interpellation' | 'expense';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface GlobalSearchData {
  results: Record<SearchResultType, SearchResult[]>;
  /** Moduły, których nie udało się przeszukać (np. brak uprawnień RLS / błąd sieci). */
  failed: SearchResultType[];
}

export const SEARCH_MIN_LENGTH = 2;
const DEBOUNCE_MS = 200;
const LIMIT = 5;
const MAX_TOKENS = 4;

export const SEARCH_RESULT_HREF: Record<SearchResultType, (id: string) => string> = {
  case: (id) => `/biuro/sprawy?open=${encodeURIComponent(id)}`,
  contact: (id) => `/biuro/kontakty?open=${encodeURIComponent(id)}`,
  event: (id) => `/biuro/kalendarz?open=${encodeURIComponent(id)}`,
  interpellation: (id) => `/biuro/interpelacje/${encodeURIComponent(id)}`,
  expense: (id) => `/biuro/budzet?open=${encodeURIComponent(id)}`,
};

/**
 * Każde słowo musi wystąpić w którymś z pól (AND między słowami, OR między polami).
 * Escapowanie jak w useCases/useContacts/useEvents/useExpenses (znaki specjalne PostgREST `or()`).
 */
function orFilters(term: string, fields: string[]): string[] {
  return term
    .split(/\s+/)
    .map((token) => token.replace(/[\\,()]/g, ''))
    .filter(Boolean)
    .slice(0, MAX_TOKENS)
    .map((token) => fields.map((f) => `${f}.ilike.%${token}%`).join(','));
}

const dateFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });
const moneyFmt = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : dateFmt.format(d);
}

function joinMeta(parts: Array<string | null | undefined>): string | null {
  const filtered = parts.filter((p): p is string => Boolean(p && p.trim()));
  return filtered.length ? filtered.join(' · ') : null;
}

function result(type: SearchResultType, id: string, title: string, subtitle: string | null): SearchResult {
  return { type, id, title: title.trim() || 'Bez tytułu', subtitle, href: SEARCH_RESULT_HREF[type](id) };
}

async function searchCases(term: string): Promise<SearchResult[]> {
  let q = supabase
    .from('cases')
    .select('id, title, status, reporter_name, created_at')
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  for (const f of orFilters(term, ['title', 'description'])) q = q.or(f);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Pick<Case, 'id' | 'title' | 'status' | 'reporter_name' | 'created_at'>[];
  return rows.map((r) =>
    result(
      'case',
      r.id,
      r.title,
      joinMeta([CASE_STATUS_LABELS[r.status], r.reporter_name, formatDate(r.created_at)]),
    ),
  );
}

async function searchContacts(term: string): Promise<SearchResult[]> {
  let q = supabase
    .from('contacts')
    .select('id, first_name, last_name, function, phone, email')
    .order('last_name', { ascending: true })
    .limit(LIMIT);
  for (const f of orFilters(term, ['first_name', 'last_name', 'function', 'email', 'phone'])) {
    q = q.or(f);
  }
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Pick<
    Contact,
    'id' | 'first_name' | 'last_name' | 'function' | 'phone' | 'email'
  >[];
  return rows.map((r) =>
    result(
      'contact',
      r.id,
      `${r.first_name ?? ''} ${r.last_name ?? ''}`,
      joinMeta([r.function, r.email, r.phone]),
    ),
  );
}

async function searchEvents(term: string): Promise<SearchResult[]> {
  let q = supabase
    .from('events')
    .select('id, title, type, starts_at, location')
    .order('starts_at', { ascending: false })
    .limit(LIMIT);
  for (const f of orFilters(term, ['title', 'description', 'location'])) q = q.or(f);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Pick<CalendarEvent, 'id' | 'title' | 'type' | 'starts_at' | 'location'>[];
  return rows.map((r) =>
    result(
      'event',
      r.id,
      r.title,
      joinMeta([formatDate(r.starts_at), EVENT_TYPE_LABELS[r.type], r.location]),
    ),
  );
}

async function searchInterpellations(term: string): Promise<SearchResult[]> {
  let q = supabase
    .from('interpellations')
    .select('id, subject, recipient, status, created_at')
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  for (const f of orFilters(term, ['subject', 'recipient', 'content_text'])) q = q.or(f);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Pick<
    Interpellation,
    'id' | 'subject' | 'recipient' | 'status' | 'created_at'
  >[];
  return rows.map((r) =>
    result(
      'interpellation',
      r.id,
      r.subject,
      joinMeta([INTERPELLATION_STATUS_SHORT[r.status], r.recipient]),
    ),
  );
}

async function searchExpenses(term: string): Promise<SearchResult[]> {
  let q = supabase
    .from('office_expenses')
    .select('id, title, vendor, amount, expense_date')
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  for (const f of orFilters(term, ['title', 'description', 'vendor', 'invoice_number'])) q = q.or(f);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Pick<
    OfficeExpense,
    'id' | 'title' | 'vendor' | 'amount' | 'expense_date'
  >[];
  return rows.map((r) =>
    result(
      'expense',
      r.id,
      r.title,
      joinMeta([
        Number.isFinite(Number(r.amount)) ? moneyFmt.format(Number(r.amount)) : null,
        r.vendor,
        formatDate(r.expense_date),
      ]),
    ),
  );
}

const SEARCHERS: Record<SearchResultType, (term: string) => Promise<SearchResult[]>> = {
  case: searchCases,
  contact: searchContacts,
  event: searchEvents,
  interpellation: searchInterpellations,
  expense: searchExpenses,
};

const TYPES = Object.keys(SEARCHERS) as SearchResultType[];

async function runSearch(term: string): Promise<GlobalSearchData> {
  // allSettled: błąd jednego modułu nie blokuje wyników z pozostałych.
  const settled = await Promise.allSettled(TYPES.map((type) => SEARCHERS[type](term)));
  const results = {} as Record<SearchResultType, SearchResult[]>;
  const failed: SearchResultType[] = [];
  settled.forEach((s, i) => {
    const type = TYPES[i];
    if (s.status === 'fulfilled') {
      results[type] = s.value;
    } else {
      results[type] = [];
      failed.push(type);
    }
  });
  if (failed.length === TYPES.length) {
    throw new Error('Wyszukiwanie nie powiodło się');
  }
  return { results, failed };
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Wyszukiwanie globalne (paleta Ctrl/Cmd+K). Debounce 200 ms, min. 2 znaki,
 * po 5 wyników z każdego modułu. Dostęp do rekordów ogranicza RLS.
 */
export function useGlobalSearch(rawTerm: string) {
  const term = useDebouncedValue(rawTerm.trim().replace(/\s+/g, ' '), DEBOUNCE_MS);
  const enabled = term.length >= SEARCH_MIN_LENGTH;
  const query = useQuery<GlobalSearchData>({
    queryKey: ['global-search', term.toLowerCase()],
    queryFn: () => runSearch(term),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const pending = rawTerm.trim().replace(/\s+/g, ' ') !== term;
  return {
    ...query,
    term,
    enabled,
    /** Trwa debounce lub zapytanie - do wskaźnika ładowania. */
    isSearching: enabled && (pending || query.isFetching),
  };
}

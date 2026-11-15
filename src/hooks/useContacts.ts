import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Contact, ContactType, ContactWithRelations } from '@/integrations/supabase/types';

export const CONTACTS_PAGE_SIZE = 25;

export interface ContactsFilters {
  type?: ContactType | null;
  powiatId?: number | null;
  gminaId?: number | null;
  createdBy?: string | null;
  search?: string;
  newsletterConsent?: boolean | null;
}

export interface ContactsPage {
  contacts: ContactWithRelations[];
  total: number;
}

const SELECT_WITH_RELATIONS = `
  id, type, first_name, last_name, function, phone, email,
  powiat_id, gmina_id, miejscowosc, street, postal_code, notes, tags,
  newsletter_consent, gr_contact_id,
  created_by, created_at, updated_at,
  powiat:powiaty(id, name),
  gmina:gminy(id, name),
  creator:profiles!contacts_created_by_fkey(id, full_name, avatar_url)
`;

function escapeOrToken(input: string): string {
  return input.replace(/[\\,()]/g, '');
}

/**
 * Filtry listy kontaktów jako warunki PostgREST - wspólne dla strony listy i „Zaznacz wszystkie”,
 * żeby zaznaczenie obejmowało dokładnie te rekordy, które widać w wynikach.
 */
function contactsFilterParts(filters: ContactsFilters): {
  match: Record<string, string | number | boolean>;
  or: string | null;
} {
  const match: Record<string, string | number | boolean> = {};
  if (filters.type) match.type = filters.type;
  if (filters.powiatId != null) match.powiat_id = filters.powiatId;
  if (filters.gminaId != null) match.gmina_id = filters.gminaId;
  if (filters.createdBy != null) match.created_by = filters.createdBy;
  if (filters.newsletterConsent != null) match.newsletter_consent = filters.newsletterConsent;
  const search = (filters.search ?? '').trim();
  if (search.length < 2) return { match, or: null };
  const term = `%${escapeOrToken(search)}%`;
  return { match, or: `first_name.ilike.${term},last_name.ilike.${term},function.ilike.${term}` };
}

export function useContacts(filters: ContactsFilters = {}, page = 0) {
  return useQuery<ContactsPage>({
    queryKey: [
      'contacts',
      filters.type ?? null,
      filters.powiatId ?? null,
      filters.gminaId ?? null,
      filters.createdBy ?? null,
      (filters.search ?? '').trim().toLowerCase(),
      filters.newsletterConsent ?? null,
      page,
    ],
    queryFn: async () => {
      const from = page * CONTACTS_PAGE_SIZE;
      const to = from + CONTACTS_PAGE_SIZE - 1;

      const parts = contactsFilterParts(filters);
      let query = supabase
        .from('contacts')
        .select(SELECT_WITH_RELATIONS, { count: 'exact' })
        .match(parts.match)
        .order('last_name', { ascending: true })
        .range(from, to);
      if (parts.or) query = query.or(parts.or);

      const { data, count, error } = await query;
      if (error) throw error;
      return {
        contacts: (data ?? []) as unknown as ContactWithRelations[],
        total: count ?? 0,
      };
    },
    staleTime: 30_000,
  });
}

/** Limit wierszy na odpowiedź PostgREST (`max_rows` w supabase/config.toml). */
const ID_FETCH_PAGE = 1000;

/** Id wszystkich kontaktów pasujących do filtrów (wszystkie strony) - dla „Zaznacz wszystkie”. */
export async function fetchAllContactIds(filters: ContactsFilters): Promise<string[]> {
  const parts = contactsFilterParts(filters);
  const ids: string[] = [];
  for (let from = 0; ; from += ID_FETCH_PAGE) {
    let query = supabase
      .from('contacts')
      .select('id')
      .match(parts.match)
      .order('id', { ascending: true })
      .range(from, from + ID_FETCH_PAGE - 1);
    if (parts.or) query = query.or(parts.or);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) ids.push(r.id);
    if (rows.length < ID_FETCH_PAGE) return ids;
  }
}

/**
 * Filtr `.in('id', ids)` trafia do URL - przy „Zaznacz wszystkie” (tysiące UUID) przekroczyłby
 * limit długości URL, więc operacje masowe dzielimy na paczki.
 */
const IN_CHUNK = 150;

function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Pojedynczy kontakt po id (deep-link `?open=<id>`); `null` gdy brak rekordu lub dostępu (RLS). */
export function useContact(id: string | null) {
  return useQuery<ContactWithRelations | null>({
    queryKey: ['contacts', 'detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select(SELECT_WITH_RELATIONS)
        .eq('id', id as string)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as ContactWithRelations | null;
    },
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// gr_contact_id jest zarządzany przez edge function (service_role) - nie w standardowym zapisie
export type ContactInput = Omit<
  Contact,
  'id' | 'created_at' | 'updated_at' | 'created_by' | 'gr_contact_id'
>;

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ContactInput) => {
      const { data, error } = await supabase
        .from('contacts')
        .insert(input)
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contacts-stats'] });
    },
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<ContactInput> & { id: string }) => {
      const { error } = await supabase.from('contacts').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contacts-stats'] });
    },
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contacts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contacts-stats'] });
    },
  });
}

export function useBulkDeleteContacts() {
  const qc = useQueryClient();
  return useMutation<number, Error, string[]>({
    mutationFn: async (ids) => {
      for (const part of chunk(ids)) {
        const { error } = await supabase.from('contacts').delete().in('id', part);
        if (error) throw error;
      }
      return ids.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contacts-stats'] });
    },
  });
}

export function useBulkUpdateContacts() {
  const qc = useQueryClient();
  return useMutation<number, Error, { ids: string[]; patch: Partial<ContactInput> }>({
    mutationFn: async ({ ids, patch }) => {
      for (const part of chunk(ids)) {
        const { error } = await supabase.from('contacts').update(patch).in('id', part);
        if (error) throw error;
      }
      return ids.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contacts-stats'] });
    },
  });
}

/** Pola, które można zmienić masowo dla zaznaczonych kontaktów (wspólne dla wielu osób). */
export type BulkContactPatch = Partial<
  Pick<ContactInput, 'newsletter_consent' | 'function' | 'miejscowosc' | 'postal_code' | 'street'>
>;

/** Kontakt, któremu masowa edycja zmieniła zgodę na newsletter - do synchronizacji z GetResponse. */
export type ConsentChangedContact = Pick<
  Contact,
  'id' | 'first_name' | 'last_name' | 'email' | 'gr_contact_id'
>;

export interface BulkEditContactsResult {
  updated: number;
  consentChanged: ConsentChangedContact[];
  /** Kontakty pominięte przy nadawaniu zgody, bo nie mają adresu e-mail (jak w formularzu). */
  skippedNoEmail: number;
}

export function useBulkEditContacts() {
  const qc = useQueryClient();
  return useMutation<BulkEditContactsResult, Error, { ids: string[]; patch: BulkContactPatch }>({
    mutationFn: async ({ ids, patch }) => {
      const empty: BulkEditContactsResult = { updated: 0, consentChanged: [], skippedNoEmail: 0 };
      if (ids.length === 0) return empty;
      const { newsletter_consent: consent, ...rest } = patch;

      if (Object.keys(rest).length > 0) {
        for (const part of chunk(ids)) {
          const { error } = await supabase.from('contacts').update(rest).in('id', part);
          if (error) throw error;
        }
      }
      if (consent === undefined) return { ...empty, updated: ids.length };

      const rows: (ConsentChangedContact & { newsletter_consent: boolean })[] = [];
      for (const part of chunk(ids)) {
        const { data, error: readError } = await supabase
          .from('contacts')
          .select('id, first_name, last_name, email, gr_contact_id, newsletter_consent')
          .in('id', part);
        if (readError) throw readError;
        rows.push(...((data ?? []) as (ConsentChangedContact & { newsletter_consent: boolean })[]));
      }
      // Zgoda wymaga e-maila (ta sama reguła co w ContactFormDialog); cofnięcie zgody - zawsze.
      const eligible = consent ? rows.filter((r) => r.email?.trim()) : rows;
      const eligibleIds = eligible.map((r) => r.id);
      for (const part of chunk(eligibleIds)) {
        const { error } = await supabase
          .from('contacts')
          .update({ newsletter_consent: consent })
          .in('id', part);
        if (error) throw error;
      }
      return {
        updated: Object.keys(rest).length > 0 ? ids.length : eligibleIds.length,
        consentChanged: eligible
          .filter((r) => r.newsletter_consent !== consent)
          .map(({ id, first_name, last_name, email, gr_contact_id }) => ({
            id,
            first_name,
            last_name,
            email,
            gr_contact_id,
          })),
        skippedNoEmail: rows.length - eligible.length,
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contacts-stats'] });
    },
  });
}

export function useNewsletterConsentCount() {
  return useQuery<number>({
    queryKey: ['contacts-stats', 'newsletter-consent'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('newsletter_consent', true);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
  });
}

// Liczniki per powiat - wykorzystywane przez mapę SVG (widok powiatów)
export function useContactsCountByPowiat() {
  return useQuery<Record<number, number>>({
    queryKey: ['contacts-stats', 'by-powiat'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('powiat_id');
      if (error) throw error;
      const counts: Record<number, number> = {};
      for (const row of data ?? []) {
        const id = (row as { powiat_id: number }).powiat_id;
        counts[id] = (counts[id] ?? 0) + 1;
      }
      return counts;
    },
    staleTime: 30_000,
  });
}

// Liczniki per gmina - wykorzystywane przez mapę SVG (widok gmin)
export function useContactsCountByGmina() {
  return useQuery<Record<number, number>>({
    queryKey: ['contacts-stats', 'by-gmina'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('gmina_id');
      if (error) throw error;
      const counts: Record<number, number> = {};
      for (const row of data ?? []) {
        const id = (row as { gmina_id: number | null }).gmina_id;
        if (id == null) continue;
        counts[id] = (counts[id] ?? 0) + 1;
      }
      return counts;
    },
    staleTime: 30_000,
  });
}

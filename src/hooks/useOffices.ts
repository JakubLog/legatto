import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Office, PublicStaffMember } from '@/integrations/supabase/types';

// Lista pracowników biura widoczna publicznie (anon dozwolony przez SECURITY DEFINER funkcje).
// Wymaga migracji 20260427100000_profiles_public_fields.sql.
export function usePublicOfficeStaff(officeId: string | null) {
  return useQuery<PublicStaffMember[]>({
    queryKey: ['public-office-staff', officeId],
    enabled: Boolean(officeId),
    queryFn: async () => {
      if (!officeId) return [];
      const { data, error } = await supabase.rpc('get_public_office_staff', {
        p_office_id: officeId,
      });
      if (error) throw error;
      return (data ?? []) as PublicStaffMember[];
    },
    staleTime: 5 * 60_000,
  });
}

// Public hook - używany na publicznej stronie głównej.
// Wymaga policy `offices_select_anon` (migracja 20260427000000_offices_public_read.sql).
export function usePublicOffices() {
  return useQuery<Office[]>({
    queryKey: ['public-offices'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offices')
        .select('id, name, city, address, phone, email, is_main, is_active, created_at, updated_at')
        .eq('is_active', true)
        .order('is_main', { ascending: false })
        .order('city', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Office[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useOffices(options?: { activeOnly?: boolean }) {
  const activeOnly = options?.activeOnly ?? false;
  return useQuery<Office[]>({
    queryKey: ['offices', { activeOnly }],
    queryFn: async () => {
      let query = supabase
        .from('offices')
        .select('id, name, city, address, phone, email, is_main, is_active, created_at, updated_at')
        .order('is_main', { ascending: false })
        .order('name', { ascending: true });
      if (activeOnly) query = query.eq('is_active', true);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Office[];
    },
    staleTime: 60_000,
  });
}

interface CreateOfficeInput {
  name: string;
  city: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  is_main?: boolean;
}

export function useCreateOffice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOfficeInput) => {
      const { data, error } = await supabase
        .from('offices')
        .insert({
          name: input.name,
          city: input.city,
          address: input.address ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          is_main: input.is_main ?? false,
        })
        .select('id')
        .single();
      if (error) throw error;
      // Audit office.create zapisuje trigger na public.offices.
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['offices'] });
    },
  });
}

interface UpdateOfficeInput {
  id: string;
  name?: string;
  city?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  is_main?: boolean;
  is_active?: boolean;
}

export function useUpdateOffice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateOfficeInput) => {
      const { error } = await supabase.from('offices').update(patch).eq('id', id);
      if (error) throw error;
      // Audit office.update zapisuje trigger na public.offices.
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['offices'] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

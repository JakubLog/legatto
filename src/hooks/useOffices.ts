import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Office } from '@/integrations/supabase/types';

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

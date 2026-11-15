import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CaseCategory } from '@/integrations/supabase/types';

export function useCaseCategories() {
  return useQuery<CaseCategory[]>({
    queryKey: ['case-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_categories')
        .select('id, name, slug, color, is_system, created_by, created_at')
        .order('is_system', { ascending: false })
        .order('name');
      if (error) throw error;
      return (data ?? []) as CaseCategory[];
    },
    staleTime: 5 * 60_000,
  });
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export function useCreateCaseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<CaseCategory> => {
      const trimmed = name.trim();
      if (trimmed.length < 2) throw new Error('Nazwa za krótka');
      const { data, error } = await supabase
        .from('case_categories')
        .insert({ name: trimmed, slug: slugify(trimmed), is_system: false })
        .select('id, name, slug, color, is_system, created_by, created_at')
        .single();
      if (error) throw error;
      return data as CaseCategory;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['case-categories'] });
    },
  });
}

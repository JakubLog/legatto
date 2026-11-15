import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ExpenseCategory } from '@/integrations/supabase/types';
import { slugifyExpenseCategory } from '@/lib/expenses';

const CATEGORY_COLUMNS = 'id, name, slug, color, is_system, settlement_item, created_by, created_at';

export function useExpenseCategories() {
  return useQuery<ExpenseCategory[]>({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expense_categories')
        .select(CATEGORY_COLUMNS)
        .order('is_system', { ascending: false })
        .order('name');
      if (error) throw error;
      return (data ?? []) as ExpenseCategory[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useCreateExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<ExpenseCategory> => {
      const trimmed = name.trim();
      if (trimmed.length < 2) throw new Error('Nazwa za krótka');
      const { data, error } = await supabase
        .from('expense_categories')
        .insert({ name: trimmed, slug: slugifyExpenseCategory(trimmed), is_system: false })
        .select(CATEGORY_COLUMNS)
        .single();
      if (error) throw error;
      return data as ExpenseCategory;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-categories'] });
    },
  });
}

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { BUDGET_ANALYTICS_QUERY_KEY } from '@/hooks/useBudgetAnalytics';
import type { BudgetYearSummary } from '@/integrations/supabase/types';
import type { SettlementItemCode } from '@/lib/settlement';

/** Podsumowanie roku (`get_budget_year_summary`, liczone w bazie bez limitu listy wydatków). */
export function useBudgetYearSummary(year: number) {
  return useQuery<BudgetYearSummary>({
    // Pod prefiksem analityki: unieważniane po każdej zmianie wydatków (useExpenses).
    queryKey: [...BUDGET_ANALYTICS_QUERY_KEY, 'rok', year],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_budget_year_summary', { p_year: year });
      if (error) throw error;
      return data as BudgetYearSummary;
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/** Przypisanie pozycji sprawozdania do kategorii (Poseł/Administrator + aal2, także kategorie systemowe). */
export function useSetCategorySettlementItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ categoryId, item }: { categoryId: number; item: SettlementItemCode | null }) => {
      const { error } = await supabase.rpc('set_expense_category_settlement_item', {
        p_category_id: categoryId,
        p_item: item ?? '',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-categories'] });
      // Wykaz pozycji 19 w podsumowaniu zależy od przypisania.
      qc.invalidateQueries({ queryKey: [...BUDGET_ANALYTICS_QUERY_KEY, 'rok'] });
    },
  });
}

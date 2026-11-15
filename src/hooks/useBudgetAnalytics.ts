import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { BudgetAnalytics } from '@/integrations/supabase/types';

/** Prefiks klucza analityki budżetu - unieważniany po każdej zmianie wydatków. */
export const BUDGET_ANALYTICS_QUERY_KEY = ['budget-analytics'] as const;

/** Analityka budżetu wybranego miesiąca (`get_budget_analytics`, liczona w bazie). */
export function useBudgetAnalytics(month: string) {
  return useQuery<BudgetAnalytics>({
    queryKey: [...BUDGET_ANALYTICS_QUERY_KEY, month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_budget_analytics', { p_month: month });
      if (error) throw error;
      return data as BudgetAnalytics;
    },
    // Zmiana miesiąca (np. klik w słupek wykresu) nie czyści widoku do szkieletu.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

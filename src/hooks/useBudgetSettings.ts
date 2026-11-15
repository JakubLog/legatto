import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  DEFAULT_MONTHLY_LIMIT_PLN,
  budgetSettingsSchema,
  parseBudgetSettings,
  type BudgetSettings,
} from '@/lib/expenses';

export const BUDGET_SETTINGS_KEY = ['budget-settings'] as const;

/** `app_settings.budget_settings` (odczyt: aktywny użytkownik + aal2). Brak wiersza = wartość domyślna. */
export function useBudgetSettings() {
  return useQuery<BudgetSettings>({
    queryKey: BUDGET_SETTINGS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'budget_settings')
        .maybeSingle();
      if (error) throw error;
      return parseBudgetSettings(data?.value);
    },
    staleTime: 5 * 60_000,
  });
}

/** Miesięczny limit koszyka w zł; do czasu odczytu (lub przy błędzie) wartość domyślna - `isError` mówi, że to nie prawdziwy limit. */
export interface MonthlyBudgetLimit {
  limit: number;
  isLoading: boolean;
  isError: boolean;
}

export function useMonthlyBudgetLimit(): MonthlyBudgetLimit {
  const { data, isLoading, isError } = useBudgetSettings();
  return { limit: data?.monthly_limit_pln ?? DEFAULT_MONTHLY_LIMIT_PLN, isLoading, isError };
}

/** Zapis limitu (Poseł/Administrator + aal2 - polityka app_settings_update_posel). */
export function useUpdateBudgetSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: BudgetSettings) => {
      const value = budgetSettingsSchema.parse(settings);
      // UPDATE zamiast upsert: wiersz zakłada migracja; select() wykrywa 0 wierszy (RLS).
      const { data, error } = await supabase
        .from('app_settings')
        .update({ value })
        .eq('key', 'budget_settings')
        .select('key');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Brak uprawnień do zmiany limitu budżetu');
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: BUDGET_SETTINGS_KEY });
    },
  });
}

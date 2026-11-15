import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { BUDGET_ANALYTICS_QUERY_KEY } from '@/hooks/useBudgetAnalytics';
import type {
  OfficeExpense,
  OfficeExpenseWithRelations,
} from '@/integrations/supabase/types';

export interface ExpensesFilters {
  categoryId?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  search?: string;
}

const SELECT_WITH_RELATIONS = `
  id, title, description, amount,
  category_id, expense_date, vendor, invoice_number,
  payment_method, receipt_path, receipt_mime, notes,
  created_by, created_at, updated_at,
  category:expense_categories(id, name, color),
  creator:profiles!office_expenses_created_by_fkey(id, full_name)
`;

function escapeOrToken(input: string): string {
  return input.replace(/[\\,()]/g, '');
}

export function useExpenses(filters: ExpensesFilters = {}) {
  return useQuery<OfficeExpenseWithRelations[]>({
    queryKey: [
      'expenses',
      filters.categoryId ?? null,
      filters.dateFrom ?? null,
      filters.dateTo ?? null,
      (filters.search ?? '').trim().toLowerCase(),
    ],
    queryFn: async () => {
      let query = supabase
        .from('office_expenses')
        .select(SELECT_WITH_RELATIONS)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500);

      if (filters.categoryId !== undefined && filters.categoryId !== null) {
        query = query.eq('category_id', filters.categoryId);
      }
      if (filters.dateFrom) query = query.gte('expense_date', filters.dateFrom);
      if (filters.dateTo) query = query.lte('expense_date', filters.dateTo);

      const search = (filters.search ?? '').trim();
      if (search.length >= 2) {
        const term = `%${escapeOrToken(search)}%`;
        query = query.or(
          `title.ilike.${term},description.ilike.${term},vendor.ilike.${term},invoice_number.ilike.${term}`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as OfficeExpenseWithRelations[];
    },
    staleTime: 30_000,
  });
}

/** Pojedynczy wydatek po id (deep-link `?open=<id>`). `null` gdy brak rekordu lub brak dostepu (RLS). */
export function useExpense(id: string | null | undefined) {
  return useQuery<OfficeExpenseWithRelations | null>({
    queryKey: ['expenses', 'detail', id ?? null],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('office_expenses')
        .select(SELECT_WITH_RELATIONS)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as OfficeExpenseWithRelations | null;
    },
    enabled: Boolean(id),
    staleTime: 30_000,
    retry: false,
  });
}

export type ExpenseInput = Omit<
  OfficeExpense,
  'id' | 'created_at' | 'updated_at' | 'created_by' | 'missing_invoice_file'
>;

/** Po zmianie wydatku: listy wydatków i analityka budżetu (sumy, sygnały). */
function invalidateExpenseData(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['expenses'] });
  qc.invalidateQueries({ queryKey: BUDGET_ANALYTICS_QUERY_KEY });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ExpenseInput) => {
      const { data, error } = await supabase
        .from('office_expenses')
        .insert(input)
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateExpenseData(qc),
  });
}

/**
 * `expectedReceiptPath` (gdy patch zmienia plik): zapis tylko, jesli w bazie jest nadal plik z chwili
 * otwarcia formularza. Inaczej nadpisalibysmy plik podpiety w miedzyczasie przez MCP
 * (`budget_receipt_attach`), a cron sprzatajacy bucket `receipts` usunalby go jako osierocony.
 */
export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      expectedReceiptPath,
      ...patch
    }: Partial<ExpenseInput> & { id: string; expectedReceiptPath?: string | null }) => {
      const query = supabase.from('office_expenses').update(patch).eq('id', id);
      if (expectedReceiptPath === undefined) {
        const { error } = await query;
        if (error) throw error;
        return;
      }
      const guarded = expectedReceiptPath === null ? query.is('receipt_path', null) : query.eq('receipt_path', expectedReceiptPath);
      const { data, error } = await guarded.select('id');
      if (error) throw error;
      if (!data?.length) {
        throw new Error('Plik faktury tego wydatku zmienił się w międzyczasie. Zamknij formularz, odśwież listę i spróbuj ponownie.');
      }
    },
    onSuccess: () => invalidateExpenseData(qc),
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    // Paragon zostaje w storage, dopóki wydatek jest w koszu; po usunięciu z kosza sprząta go
    // nocny cron (`receipts_orphan_objects`).
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('office_expenses').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateExpenseData(qc),
  });
}

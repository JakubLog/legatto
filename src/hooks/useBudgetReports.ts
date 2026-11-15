import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import type { BudgetReport, BudgetReportWithCreator } from '@/integrations/supabase/types';
import { AiError } from '@/hooks/useAi';
import { readHttpError } from '@/hooks/usePoliAI';
import { errorMessage } from '@/lib/errors';
import type { MpForms } from '@/lib/mpForms';
import { useMpForms } from '@/hooks/useMpForms';

export const BUDGET_REPORTS_KEY = ['budget-reports'] as const;
/** Klucz mutacji generowania - widok raportów odtwarza stan "w toku" po powrocie na stronę. */
export const GENERATE_BUDGET_REPORT_KEY = ['budget-reports', 'generate'] as const;

const SELECT_WITH_CREATOR = `
  id, period, content, analytics, model, created_by, created_at,
  creator:profiles!budget_reports_created_by_fkey(id, full_name)
`;

/** Raporty AI wybranego miesiąca (`YYYY-MM`), najnowszy pierwszy. */
export function useBudgetReports(month: string) {
  return useQuery<BudgetReportWithCreator[]>({
    queryKey: [...BUDGET_REPORTS_KEY, 'list', month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('budget_reports')
        .select(SELECT_WITH_CREATOR)
        .eq('period', month)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as BudgetReportWithCreator[];
    },
    staleTime: 30_000,
  });
}

const GenerateResponseSchema = z.object({
  report: z.object({ id: z.string(), period: z.string() }).passthrough(),
});

const SESSION_EXPIRED = 'Sesja wygasła. Zaloguj się ponownie.';

/** `POST /api/poliai?op=budget-report`; po 401 odświeża sesję raz (jak `usePoliAIAttachments`). */
async function requestBudgetReport(month: string): Promise<BudgetReport> {
  let refreshed = false;
  for (;;) {
    const { data } = refreshed ? await supabase.auth.refreshSession() : await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new AiError(SESSION_EXPIRED);
    const res = await fetch('/api/poliai?op=budget-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ month }),
    });
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      continue;
    }
    if (!res.ok) {
      const fromApi = res.headers.get('content-type')?.includes('application/json') ?? false;
      const { message, code } = await readHttpError(res);
      // Limit czasu platformy (odpowiedź spoza API, bez JSON-a) - zrozumiały komunikat zamiast ogólnego.
      if (res.status === 504 && !fromApi) throw new AiError('Generowanie raportu trwało zbyt długo. Spróbuj ponownie.');
      throw new AiError(message, code);
    }
    const parsed = GenerateResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new AiError('PoliAI zwrócił nieoczekiwaną odpowiedź. Spróbuj ponownie.');
    return parsed.data.report as unknown as BudgetReport;
  }
}

/** Komunikat błędu generowania (tytuł + opis) zależnie od kodu z API. */
function generateErrorToast(err: unknown, mp: MpForms): { title: string; description: string } {
  const code = err instanceof AiError ? err.code : undefined;
  switch (code) {
    case 'AI_NOT_CONFIGURED':
      return {
        title: 'PoliAI nie jest skonfigurowany',
        description: `${mp.nominative} lub Administrator musi ustawić klucz i model w Integracje → AI.`,
      };
    case 'BUDGET_REPORT_LIMIT':
      return { title: 'Wykorzystano dzienny limit raportów', description: errorMessage(err) };
    case 'BUDGET_REPORT_EMPTY':
      return {
        title: 'Brak wydatków do analizy',
        description: 'W tym miesiącu nie ma jeszcze żadnych wydatków - raport nie ma z czego powstać.',
      };
    default:
      return { title: 'Nie udało się wygenerować raportu', description: errorMessage(err) };
  }
}

/**
 * Generowanie raportu AI (do ~2 min). Powiadomienia są w opcjach mutacji, więc działają także po
 * opuszczeniu strony w trakcie generowania.
 */
export function useGenerateBudgetReport() {
  const qc = useQueryClient();
  const mp = useMpForms();
  return useMutation({
    mutationKey: GENERATE_BUDGET_REPORT_KEY,
    mutationFn: ({ month }: { month: string }) => requestBudgetReport(month),
    onSuccess: async () => {
      // Czekamy na odświeżenie listy - przycisk zostaje w stanie "w toku" do pojawienia się raportu.
      await qc.invalidateQueries({ queryKey: BUDGET_REPORTS_KEY });
      toast.success('Raport AI gotowy');
    },
    onError: (err) => {
      const { title, description } = generateErrorToast(err, mp);
      toast.error(title, { description });
    },
  });
}

export function useDeleteBudgetReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // RLS po cichu pomija wiersze bez uprawnień - zwrócone id potwierdza faktyczne usunięcie.
      const { data, error } = await supabase.from('budget_reports').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Raport nie istnieje albo nie masz uprawnień do jego usunięcia.');
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: BUDGET_REPORTS_KEY });
    },
  });
}

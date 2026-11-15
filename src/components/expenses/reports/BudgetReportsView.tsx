import { useEffect, useState } from 'react';
import { useMutationState } from '@tanstack/react-query';
import {
  EyeOff,
  Lightbulb,
  Loader2,
  type LucideIcon,
  Scale,
  Sparkles,
  Target,
  Telescope,
} from 'lucide-react';
import { ErrorNotice } from '@/components/admin/AdminUi';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import {
  GENERATE_BUDGET_REPORT_KEY,
  useBudgetReports,
  useGenerateBudgetReport,
} from '@/hooks/useBudgetReports';
import { useMpForms } from '@/hooks/useMpForms';
import type { BudgetReportWithCreator } from '@/integrations/supabase/types';
import { errorMessage } from '@/lib/errors';
import { formatMonthLabel } from '@/lib/expenses';
import { canWrite, isAdmin } from '@/lib/permissions';
import { BudgetReportDocument } from './BudgetReportDocument';
import { BudgetReportHistory } from './BudgetReportHistory';
import { DeleteBudgetReportDialog } from './DeleteBudgetReportDialog';

const REPORT_PARTS: { icon: LucideIcon; label: string }[] = [
  { icon: Scale, label: 'Porównania z poprzednimi miesiącami i z rokiem wcześniej' },
  { icon: Lightbulb, label: 'Wnioski o kategoriach, kontrahentach i nietypowych wydatkach' },
  { icon: EyeOff, label: 'Ukryte koszty: abonamenty, opłaty, prowizje, możliwe duplikaty' },
  { icon: Target, label: 'Rekomendacje z szacowaną oszczędnością' },
  { icon: Telescope, label: 'Prognoza wydatków do końca miesiąca' },
];

/** Stan generowania (do ~2 min) z licznikiem czasu od wysłania żądania. */
function GeneratingNotice({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-medium">
          Analizuję wydatki…
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          PoliAI czyta analitykę i wydatki miesiąca, a potem pisze wnioski. Zwykle trwa to do 2 minut. Możesz przejść do
          innego widoku - nie zamykaj tylko karty przeglądarki.
        </p>
      </div>
    </div>
  );
}

function ReportsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">Ładowanie raportów</span>
      <div className="space-y-3 rounded-xl border bg-card p-4 shadow-card">
        <Skeleton className="h-5 w-40 rounded-full" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-5/6" />
      </div>
      <div className="grid gap-3 @sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}

/** Widok "Raporty AI" modułu Budżet (`?widok=raporty`) dla wybranego miesiąca (`YYYY-MM`). */
export function BudgetReportsView({ month }: { month: string }) {
  const { profile } = useAuth();
  const mp = useMpForms();
  // Generują role PoliAI (jak PoliAIProvider), usuwają Poseł/Administrator (RLS is_posel()).
  const canGenerate = canWrite(profile?.role);
  const canDelete = isAdmin(profile?.role);

  const reportsQuery = useBudgetReports(month);
  const generate = useGenerateBudgetReport();
  // Stan z cache mutacji - widoczny także po powrocie na stronę w trakcie generowania.
  const pending = useMutationState({
    filters: { mutationKey: GENERATE_BUDGET_REPORT_KEY, status: 'pending' },
    select: (m) => ({
      month: (m.state.variables as { month?: string } | undefined)?.month,
      submittedAt: m.state.submittedAt,
    }),
  });
  const pendingHere = pending.find((p) => p.month === month);
  const busy = pending.length > 0;

  const [selection, setSelection] = useState<{ month: string; id: string } | null>(null);
  const [deleting, setDeleting] = useState<BudgetReportWithCreator | null>(null);

  const reports = reportsQuery.data ?? [];
  const selectedId = selection?.month === month ? selection.id : null;
  const report = reports.find((r) => r.id === selectedId) ?? reports[0] ?? null;
  const monthLabel = formatMonthLabel(month);

  const handleGenerate = () => {
    if (busy) return;
    generate.mutate({ month }, { onSuccess: () => setSelection(null) });
  };

  const generateButton = canGenerate && (
    <Button
      onClick={handleGenerate}
      disabled={busy}
      title={busy && !pendingHere ? 'Trwa generowanie raportu za inny miesiąc' : undefined}
    >
      {pendingHere ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {pendingHere ? 'Generuję raport…' : reports.length > 0 ? 'Wygeneruj nowy raport' : 'Wygeneruj raport'}
    </Button>
  );

  if (reportsQuery.isLoading) return <ReportsSkeleton />;

  if (reportsQuery.isError) {
    return <ErrorNotice title="Nie udało się wczytać raportów AI" message={errorMessage(reportsQuery.error)} />;
  }

  if (!report) {
    return (
      <div className="space-y-4">
        {pendingHere && <GeneratingNotice startedAt={pendingHere.submittedAt || Date.now()} />}
        <section
          aria-label="Brak raportu AI"
          className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-card px-6 py-10 text-center"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="max-w-md space-y-1.5">
            <h2 className="text-base font-semibold">
              Brak raportu AI za <span className="lowercase">{monthLabel}</span>
            </h2>
            <p className="text-sm text-muted-foreground">
              PoliAI przeanalizuje wydatki miesiąca na podstawie policzonej przez system analityki i przygotuje raport:
            </p>
          </div>
          <ul className="grid max-w-xl gap-2 text-left text-sm @sm:grid-cols-2">
            {REPORT_PARTS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span>{label}</span>
              </li>
            ))}
          </ul>
          {canGenerate ? (
            !pendingHere && generateButton
          ) : (
            <p className="text-xs text-muted-foreground">
              Raport może wygenerować {mp.nominative}, Administrator lub Pracownik.
            </p>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center @sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Raporty AI za <span className="font-medium lowercase text-foreground">{monthLabel}</span>
          {reports.length > 1 && <span className="tabular-nums"> · liczba wersji: {reports.length}</span>}
        </p>
        {generateButton}
      </div>

      {pendingHere && <GeneratingNotice startedAt={pendingHere.submittedAt || Date.now()} />}

      {reports.length > 1 ? (
        <div className="grid items-start gap-4 @lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="@lg:order-last">
            <BudgetReportHistory
              reports={reports}
              selectedId={report.id}
              onSelect={(id) => setSelection({ month, id })}
            />
          </div>
          <BudgetReportDocument
            report={report}
            isLatest={report.id === reports[0].id}
            onDelete={canDelete ? () => setDeleting(report) : undefined}
          />
        </div>
      ) : (
        <BudgetReportDocument report={report} isLatest onDelete={canDelete ? () => setDeleting(report) : undefined} />
      )}

      <DeleteBudgetReportDialog report={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

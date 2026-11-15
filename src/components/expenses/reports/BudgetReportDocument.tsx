import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Telescope, Trash2 } from 'lucide-react';
import { PoliAIMarkdown } from '@/components/poliai/PoliAIMarkdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { BudgetReportWithCreator } from '@/integrations/supabase/types';
import { formatMonthLabel } from '@/lib/expenses';
import { BudgetReportKpis } from './BudgetReportKpis';
import { BudgetReportSections, ReportSection } from './BudgetReportSections';
import { expenseTitlesFromAnalytics, formatReportDate, reportAuthor } from './reportUtils';

interface Props {
  report: BudgetReportWithCreator;
  /** Najnowszy raport miesiąca (starsze mają oznaczenie archiwalne). */
  isLatest: boolean;
  onDelete?: () => void;
}

/** Pełny raport AI: nagłówek, podsumowanie, KPI z migawki, sekcje, prognoza i stopka. */
export function BudgetReportDocument({ report, isLatest, onDelete }: Props) {
  const navigate = useNavigate();
  const { content, analytics } = report;
  const expenseTitles = useMemo(() => expenseTitlesFromAnalytics(analytics), [analytics]);

  return (
    <article aria-label={`Raport AI: ${content.headline}`} className="min-w-0 space-y-4">
      <header className="rounded-xl border bg-card p-4 shadow-card @md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">
                <Sparkles />
                Raport AI
              </Badge>
              <Badge variant="outline" className="capitalize">
                {formatMonthLabel(report.period)}
              </Badge>
              {!isLatest && <Badge variant="muted">Wcześniejsza wersja</Badge>}
            </div>
            <h2 className="text-lg font-semibold leading-snug tracking-tight [overflow-wrap:anywhere] @md:text-xl">
              {content.headline}
            </h2>
          </div>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              aria-label="Usuń raport"
              title="Usuń raport"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        {content.summary.trim() && (
          <div className="mt-3 border-t pt-3">
            <PoliAIMarkdown text={content.summary} onNavigate={navigate} />
          </div>
        )}
      </header>

      <BudgetReportKpis analytics={analytics} />

      <BudgetReportSections content={content} expenseTitles={expenseTitles} />

      {content.forecast.trim() && (
        <ReportSection title="Prognoza" icon={Telescope}>
          <PoliAIMarkdown text={content.forecast} onNavigate={navigate} />
        </ReportSection>
      )}

      <footer className="space-y-1 px-1 text-xs text-muted-foreground">
        <p>
          Wygenerowano {formatReportDate(report.created_at)}
          <span className="mx-1.5" aria-hidden>
            ·
          </span>
          {reportAuthor(report)}
          <span className="mx-1.5" aria-hidden>
            ·
          </span>
          model <span className="font-mono text-[11px]">{report.model}</span>
        </p>
        <p>
          Raport przygotował model AI na podstawie danych z chwili generowania. AI może się mylić - sprawdź kluczowe
          liczby i wydatki przed podjęciem decyzji.
        </p>
      </footer>
    </article>
  );
}

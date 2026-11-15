import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  EyeOff,
  Info,
  Lightbulb,
  type LucideIcon,
  Receipt,
  Scale,
  Target,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type {
  BudgetReportContent,
  BudgetReportSeverity,
  BudgetReportTrend,
} from '@/integrations/supabase/types';
import { formatPLN } from '@/lib/expenses';
import { cn } from '@/lib/utils';

const TREND: Record<BudgetReportTrend, { icon: LucideIcon; label: string; className: string }> = {
  up: { icon: ArrowUpRight, label: 'Wzrost', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  down: { icon: ArrowDownRight, label: 'Spadek', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  flat: { icon: ArrowRight, label: 'Bez zmian', className: 'bg-muted text-muted-foreground' },
};

const SEVERITY: Record<
  BudgetReportSeverity,
  { icon: LucideIcon; label: string; bubble: string; border: string; badge: 'secondary' | 'warning' | 'destructive' }
> = {
  info: { icon: Info, label: 'Informacja', bubble: 'bg-primary/10 text-primary', border: 'border-l-primary/40', badge: 'secondary' },
  warning: {
    icon: AlertTriangle,
    label: 'Uwaga',
    bubble: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    border: 'border-l-amber-500/60',
    badge: 'warning',
  },
  critical: {
    icon: AlertOctagon,
    label: 'Pilne',
    bubble: 'bg-destructive/10 text-destructive',
    border: 'border-l-destructive/60',
    badge: 'destructive',
  },
};

interface SectionProps {
  title: string;
  icon: LucideIcon;
  /** Dodatkowa informacja po prawej stronie nagłówka (np. suma). */
  aside?: ReactNode;
  children: ReactNode;
}

export function ReportSection({ title, icon: Icon, aside, children }: SectionProps) {
  return (
    <section aria-label={title} className="rounded-xl border bg-card p-4 shadow-card @md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-primary" aria-hidden />
          {title}
        </h3>
        {aside && <p className="text-xs text-muted-foreground tabular-nums">{aside}</p>}
      </div>
      {children}
    </section>
  );
}

/** Odnośniki do wydatków wskazanych przez model (`/biuro/budzet?open=<id>`). */
function ExpenseLinks({ ids, titles }: { ids: string[]; titles: Map<string, string> }) {
  if (ids.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Powiązane wydatki">
      {ids.map((id, i) => (
        <li key={id} className="min-w-0 max-w-full">
          <Link
            to={`/biuro/budzet?open=${encodeURIComponent(id)}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
          >
            <Receipt className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{titles.get(id) ?? `wydatek ${i + 1}`}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Detail({ children }: { children: string }) {
  return <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">{children}</p>;
}

interface Props {
  content: BudgetReportContent;
  /** Tytuły wydatków z migawki analityki raportu. */
  expenseTitles: Map<string, string>;
}

/** Sekcje treści raportu AI: porównania, wnioski, ukryte koszty, rekomendacje (prognoza osobno). */
export function BudgetReportSections({ content, expenseTitles }: Props) {
  const hiddenTotal = content.hidden_costs.reduce((sum, h) => sum + (h.estimated_monthly_pln ?? 0), 0);
  const savingsTotal = content.recommendations.reduce((sum, r) => sum + (r.potential_saving_pln ?? 0), 0);

  return (
    <>
      {content.comparisons.length > 0 && (
        <ReportSection title="Porównania" icon={Scale}>
          <ul className="grid gap-3 @md:grid-cols-2">
            {content.comparisons.map((c, i) => {
              const trend = TREND[c.trend] ?? TREND.flat;
              const TrendIcon = trend.icon;
              return (
                <li key={i} className="flex gap-3">
                  <span
                    className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', trend.className)}
                    title={trend.label}
                  >
                    <TrendIcon className="h-4 w-4" aria-hidden />
                    <span className="sr-only">{trend.label}</span>
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.title}</p>
                    <Detail>{c.detail}</Detail>
                  </div>
                </li>
              );
            })}
          </ul>
        </ReportSection>
      )}

      {content.insights.length > 0 && (
        <ReportSection title="Wnioski" icon={Lightbulb}>
          <ul className="space-y-2.5">
            {content.insights.map((insight, i) => {
              const sev = SEVERITY[insight.severity] ?? SEVERITY.info;
              const SevIcon = sev.icon;
              return (
                <li key={i} className={cn('flex gap-3 rounded-lg border border-l-4 bg-background/60 p-3', sev.border)}>
                  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', sev.bubble)}>
                    <SevIcon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-sm font-medium">{insight.title}</p>
                      <Badge variant={sev.badge}>{sev.label}</Badge>
                    </div>
                    <Detail>{insight.detail}</Detail>
                    <ExpenseLinks ids={insight.expense_ids} titles={expenseTitles} />
                  </div>
                </li>
              );
            })}
          </ul>
        </ReportSection>
      )}

      {content.hidden_costs.length > 0 && (
        <ReportSection
          title="Ukryte koszty"
          icon={EyeOff}
          aside={hiddenTotal > 0 ? `Łącznie ok. ${formatPLN(hiddenTotal)} / mies.` : undefined}
        >
          <ul className="divide-y">
            {content.hidden_costs.map((cost, i) => (
              <li key={i} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 @sm:flex-row @sm:items-start @sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{cost.title}</p>
                  <Detail>{cost.detail}</Detail>
                  <ExpenseLinks ids={cost.expense_ids} titles={expenseTitles} />
                </div>
                {cost.estimated_monthly_pln !== null && (
                  <p className="shrink-0 text-sm font-semibold tabular-nums @sm:text-right">
                    ~{formatPLN(cost.estimated_monthly_pln)}
                    <span className="block text-[11px] font-normal text-muted-foreground">miesięcznie</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </ReportSection>
      )}

      {content.recommendations.length > 0 && (
        <ReportSection
          title="Rekomendacje"
          icon={Target}
          aside={savingsTotal > 0 ? `Potencjalnie do ${formatPLN(savingsTotal)} oszczędności` : undefined}
        >
          <ol className="space-y-3">
            {content.recommendations.map((rec, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-medium">{rec.title}</p>
                    {rec.potential_saving_pln !== null && rec.potential_saving_pln > 0 && (
                      <Badge variant="success" className="tabular-nums">
                        Oszczędność ~{formatPLN(rec.potential_saving_pln)}
                      </Badge>
                    )}
                  </div>
                  <Detail>{rec.detail}</Detail>
                </div>
              </li>
            ))}
          </ol>
        </ReportSection>
      )}
    </>
  );
}


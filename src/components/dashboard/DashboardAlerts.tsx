import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Mail,
  MessageSquareText,
} from 'lucide-react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import type { GrNewsletter } from '@/hooks/useGetResponse';
import { useMpForms } from '@/hooks/useMpForms';
import { cn } from '@/lib/utils';
import { pluralCases } from '@/components/dashboard/dashboardUtils';

type AlertTone = 'warning' | 'success' | 'attention';

const TONE: Record<AlertTone, { box: string; icon: string }> = {
  warning: {
    box: 'border-amber-500/30 bg-amber-50 text-amber-900 hover:bg-amber-100/80 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/15',
    icon: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  success: {
    box: 'border-emerald-500/30 bg-emerald-50 text-emerald-900 hover:bg-emerald-100/80 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/15',
    icon: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  attention: {
    box: 'border-orange-500/30 bg-orange-50 text-orange-900 hover:bg-orange-100/80 dark:bg-orange-500/10 dark:text-orange-200 dark:hover:bg-orange-500/15',
    icon: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  },
};

function AlertLink({ to, tone, icon: Icon, children }: { to: string; tone: AlertTone; icon: LucideIcon; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        'group flex min-h-12 min-w-0 flex-1 basis-72 items-center gap-3 rounded-xl border px-3 py-2 shadow-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        TONE[tone].box,
      )}
    >
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TONE[tone].icon)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
      <ArrowRight className="h-4 w-4 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" />
    </Link>
  );
}

function pluralInterpellations(n: number): string {
  if (n === 1) return 'interpelacja';
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'interpelacje';
  return 'interpelacji';
}

interface DashboardAlertsProps {
  /** Liczba spraw z terminem w ciągu 3 dni; 0 = brak alertu. */
  dueSoon: number;
  interpellationOverdue: number;
  /** Tylko dla Posła; 0 dla pozostałych ról. */
  interpellationDecision: number;
  /** Tylko dla Pracownika; 0 dla pozostałych ról. */
  interpellationCorrections: number;
  /** Widżet newslettera widoczny tylko przy aktywnym GetResponse i braku błędu. */
  showNewsletter: boolean;
  newsletterLoading: boolean;
  newsletterThisWeek: GrNewsletter | null;
}

/** Alerty pulpitu: interpelacje, sprawy blisko terminu i bieżący newsletter. */
export function DashboardAlerts({
  dueSoon,
  interpellationOverdue,
  interpellationDecision,
  interpellationCorrections,
  showNewsletter,
  newsletterLoading,
  newsletterThisWeek,
}: DashboardAlertsProps) {
  const mp = useMpForms();
  if (
    dueSoon <= 0 &&
    interpellationOverdue <= 0 &&
    interpellationDecision <= 0 &&
    interpellationCorrections <= 0 &&
    !showNewsletter
  ) {
    return null;
  }

  // flex-wrap + flex-1 basis-72: alerty zawsze wypełniają cały rząd, niezależnie od ich liczby.
  return (
    <div className="flex flex-wrap gap-3">
      {interpellationOverdue > 0 && (
        <AlertLink to="/biuro/interpelacje" tone="warning" icon={Clock}>
          <p className="font-medium">
            {interpellationOverdue} {pluralInterpellations(interpellationOverdue)} po terminie wysłania
          </p>
          <p className="text-xs opacity-80">Wymaga pilnego wysłania</p>
        </AlertLink>
      )}

      {interpellationDecision > 0 && (
        <AlertLink to="/biuro/interpelacje" tone="attention" icon={FileText}>
          <p className="font-medium">
            {interpellationDecision} {pluralInterpellations(interpellationDecision)}{' '}
            {interpellationDecision === 1 ? 'czeka' : 'czekają'} na Twoją decyzję
          </p>
          <p className="text-xs opacity-80">Akceptuj, zgłoś uwagi albo odrzuć</p>
        </AlertLink>
      )}

      {interpellationCorrections > 0 && (
        <AlertLink to="/biuro/interpelacje" tone="attention" icon={MessageSquareText}>
          <p className="font-medium">
            {interpellationCorrections} {pluralInterpellations(interpellationCorrections)} z uwagami {mp.genitive} do poprawy
          </p>
          <p className="text-xs opacity-80">Popraw i wgraj nową wersję</p>
        </AlertLink>
      )}

      {dueSoon > 0 && (
        <AlertLink to="/biuro/sprawy" tone="warning" icon={AlertTriangle}>
          <p className="font-medium">
            {dueSoon} {pluralCases(dueSoon)} blisko terminu ostatecznego
          </p>
          <p className="text-xs opacity-80">Przejdź do listy spraw</p>
        </AlertLink>
      )}

      {showNewsletter &&
        (newsletterLoading ? (
          <Skeleton className="h-12 min-w-0 flex-1 basis-72 rounded-xl" />
        ) : newsletterThisWeek ? (
          <AlertLink to="/biuro/kontakty?widok=kampanie" tone="success" icon={CheckCircle2}>
            <p className="truncate font-medium">
              Newsletter wysłany w tym tygodniu
              {newsletterThisWeek.subject || newsletterThisWeek.name ? (
                <>
                  {' — '}
                  <span className="font-semibold">{newsletterThisWeek.subject ?? newsletterThisWeek.name}</span>
                </>
              ) : null}
            </p>
            {newsletterThisWeek.sendOn && (
              <p className="text-xs opacity-80 first-letter:uppercase">
                {format(new Date(newsletterThisWeek.sendOn), 'EEEE, HH:mm', { locale: pl })}
              </p>
            )}
          </AlertLink>
        ) : (
          <AlertLink to="/biuro/kontakty?widok=kampanie" tone="attention" icon={Mail}>
            <p className="font-medium">W tym tygodniu nie wysłano newslettera</p>
            <p className="text-xs opacity-80">Przejdź do Centrum kontaktowego</p>
          </AlertLink>
        ))}
    </div>
  );
}

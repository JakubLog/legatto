import { useMemo } from 'react';
import { endOfWeek, format, isWithinInterval, startOfWeek } from 'date-fns';
import { pl } from 'date-fns/locale';
import { Briefcase, Calendar, FileText, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { isAdmin } from '@/lib/permissions';
import { CASE_STATUS_DOT, CASE_STATUS_LABELS } from '@/lib/cases';
import { INTERPELLATION_STATUS_DOT } from '@/lib/interpellations';
import {
  useCasesByArea,
  useCasesStats,
  useContactsStats,
  useDashboardInterpellations,
  useUpcomingEvents,
  useRecentCases,
} from '@/hooks/useDashboardStats';
import { useGRNewsletters, useGRStatus } from '@/hooks/useGetResponse';
import { Page, PageHeader } from '@/components/layout/Page';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { DashboardAlerts } from '@/components/dashboard/DashboardAlerts';
import { UpcomingEventsCard } from '@/components/dashboard/UpcomingEventsCard';
import { RecentCasesCard } from '@/components/dashboard/RecentCasesCard';
import { CasesByAreaCard } from '@/components/dashboard/CasesByAreaCard';
import { InterpellationsCard } from '@/components/dashboard/InterpellationsCard';
import { MyModules } from '@/components/dashboard/MyModules';
import { EngagementScore } from '@/components/dashboard/EngagementScore';
import { PushPromptBanner } from '@/components/notifications/PushPromptBanner';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  formatEventDate,
  formatEventDateAllDay,
} from '@/components/dashboard/dashboardUtils';
import { cn } from '@/lib/utils';

export default function Dashboard() {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const firstName = profile?.full_name.split(' ')[0] ?? '';

  const { data: casesStats, isLoading: casesLoading } = useCasesStats();
  const { data: contactsStats, isLoading: contactsLoading } = useContactsStats();
  const { data: upcomingEvents = [], isLoading: eventsLoading } = useUpcomingEvents();
  const { data: recentCases = [], isLoading: casesListLoading } = useRecentCases();
  const { data: casesByArea, isLoading: areaLoading } = useCasesByArea();
  const { data: interpellations, isLoading: interpLoading } = useDashboardInterpellations();

  const grStatusQ = useGRStatus(true);
  const grActive = grStatusQ.data?.ok === true;
  const grNewslettersQ = useGRNewsletters(grActive);

  const newsletterThisWeek = useMemo(() => {
    if (!grNewslettersQ.data) return null;
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    return (
      grNewslettersQ.data.find((n) => {
        if (n.status !== 'sent' || !n.sendOn) return false;
        const sentAt = new Date(n.sendOn);
        return !Number.isNaN(sentAt.getTime()) &&
          isWithinInterval(sentAt, { start: weekStart, end: weekEnd });
      }) ?? null
    );
  }, [grNewslettersQ.data]);

  const activeCases =
    (casesStats?.nowa ?? 0) + (casesStats?.w_toku ?? 0) + (casesStats?.oczekuje ?? 0);
  const dueSoon = casesStats?.due_soon ?? 0;
  const interpellationCounts = interpellations?.counts;
  const awaitingDecision =
    (interpellationCounts?.nowa ?? 0) + (interpellationCounts?.po_poprawkach ?? 0);
  const needsCorrections = interpellationCounts?.uwagi ?? 0;
  const awaitingSend = interpellationCounts?.zaakceptowana ?? 0;
  const dateLabel = format(new Date(), 'EEEE, d MMMM yyyy', { locale: pl });
  const todayLabel = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);

  const nextEvent = upcomingEvents[0];
  const alerts = (
    <DashboardAlerts
      dueSoon={casesLoading ? 0 : dueSoon}
      interpellationOverdue={interpLoading ? 0 : (interpellations?.overdue ?? 0)}
      interpellationDecision={isAdmin(profile?.role) ? awaitingDecision : 0}
      interpellationCorrections={profile?.role === 'pracownik' ? needsCorrections : 0}
      showNewsletter={grActive && !grNewslettersQ.isError}
      newsletterLoading={grNewslettersQ.isLoading}
      newsletterThisWeek={newsletterThisWeek}
    />
  );


  return (
    <Page>
      <PushPromptBanner />
      <PageHeader
        title={`Dzień dobry${firstName ? `, ${firstName}` : ''}`}
        titleAddon={<EngagementScore />}
        description={todayLabel}
      />
      {isMobile && alerts}

      <MyModules />

      {/* KPI - 2 kolumny (na telefonie kompaktowe kafelki), 4 od obszaru modułu @lg. */}
      <div className="grid min-w-0 grid-cols-2 gap-3 @lg:grid-cols-4">
        <KpiCard
          to="/biuro/sprawy"
          icon={Briefcase}
          iconClassName="bg-primary/10 text-primary"
          label="Aktywne sprawy"
          loading={casesLoading}
          value={activeCases}
          footer={
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
              {(['nowa', 'w_toku', 'oczekuje'] as const).map((s) => (
                <span key={s} className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className={cn('h-1.5 w-1.5 rounded-full', CASE_STATUS_DOT[s])} aria-hidden />
                  {casesStats?.[s] ?? 0} {CASE_STATUS_LABELS[s]}
                </span>
              ))}
            </div>
          }
        />
        <KpiCard
          to="/biuro/kontakty"
          icon={Users}
          iconClassName="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          label="Kontakty w okręgu"
          loading={contactsLoading}
          value={contactsStats?.total ?? 0}
          footer={
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                {contactsStats?.newsletter ?? 0} z newsletterem
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" aria-hidden />
                +{contactsStats?.recent ?? 0} w 30 dni
              </span>
            </div>
          }
        />
        <KpiCard
          to="/biuro/kalendarz"
          icon={Calendar}
          iconClassName="bg-blue-500/10 text-blue-600 dark:text-blue-400"
          label="Następne wydarzenie"
          loading={eventsLoading}
          textValue={Boolean(nextEvent)}
          value={
            nextEvent
              ? nextEvent.all_day
                ? formatEventDateAllDay(nextEvent.starts_at)
                : formatEventDate(nextEvent.starts_at)
              : '—'
          }
          footer={
            <p className="line-clamp-1 text-xs text-muted-foreground">
              {nextEvent ? nextEvent.title : 'Brak nadchodzących'}
            </p>
          }
        />
        <KpiCard
          to="/biuro/interpelacje"
          icon={FileText}
          iconClassName="bg-brand/10 text-brand"
          label="Interpelacje w toku"
          loading={interpLoading}
          value={interpellations?.total ?? 0}
          footer={
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className={cn('h-1.5 w-1.5 rounded-full', INTERPELLATION_STATUS_DOT.nowa)} aria-hidden />
                {awaitingDecision} do decyzji
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className={cn('h-1.5 w-1.5 rounded-full', INTERPELLATION_STATUS_DOT.uwagi)} aria-hidden />
                {needsCorrections} uwagi
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className={cn('h-1.5 w-1.5 rounded-full', INTERPELLATION_STATUS_DOT.zaakceptowana)} aria-hidden />
                {awaitingSend} do wysłania
              </span>
            </div>
          }
        />
      </div>

      {!isMobile && alerts}

      <QuickActions />

      {/*
        Dwie kolumny o zbliżonej wysokości: lewa (wydarzenia + sprawy w okręgu), prawa (interpelacje + ostatnie sprawy).
        W jednej kolumnie kolumny-wrappery znikają (contents), a kolejność ustawia order: sprawy w okręgu na końcu.
      */}
      <div className="grid min-w-0 items-start gap-4 @md:grid-cols-2 @lg:grid-cols-5">
        <div className="flex min-w-0 flex-col gap-4 @max-md:contents @lg:col-span-3">
          <UpcomingEventsCard className="@max-md:order-1" events={upcomingEvents} loading={eventsLoading} />
          <CasesByAreaCard className="@max-md:order-4" data={casesByArea} loading={areaLoading} />
        </div>
        <div className="flex min-w-0 flex-col gap-4 @max-md:contents @lg:col-span-2">
          <InterpellationsCard className="@max-md:order-2" items={interpellations?.items} loading={interpLoading} />
          <RecentCasesCard className="@max-md:order-3" cases={recentCases} loading={casesListLoading} />
        </div>
      </div>
    </Page>
  );
}

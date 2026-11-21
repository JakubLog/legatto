import { useEffect, useMemo, useState } from 'react';
import { FileCheck2, FileText, Layers, MessageSquareText, Plug, Plus, Send, type LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SearchSelect } from '@/components/ui/search-select';
import { Page, PageHeader } from '@/components/layout/Page';
import { ModuleOwners } from '@/components/common/ModuleOwners';
import { MonthNav } from '@/components/events/CalendarToolbar';
import { useAuth } from '@/contexts/AuthContext';
import { canWrite, isAdmin } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { INSTANCE } from '@/lib/instance';
import {
  INTERPELLATION_LAYOUTS,
  INTERPELLATION_STATUSES,
  INTERPELLATION_STATUS_DOT,
  INTERPELLATION_STATUS_SHORT,
  deadlineState,
  isAwaitingDecision,
  isTerminal,
  type InterpellationsLayout,
} from '@/lib/interpellations';
import { DeleteInterpellationDialog } from '@/components/interpellations/DeleteInterpellationDialog';
import { InterpellationUploadDialog } from '@/components/interpellations/InterpellationUploadDialog';
import { InterpellationsBoard } from '@/components/interpellations/InterpellationsBoard';
import { InterpellationsCalendar } from '@/components/interpellations/InterpellationsCalendar';
import { InterpellationsList } from '@/components/interpellations/InterpellationsList';
import { InterpellationMetrics } from '@/components/interpellations/InterpellationMetrics';
import { InterpellationViewTabs } from '@/components/interpellations/InterpellationViewTabs';
import { MarkSentDialog } from '@/components/interpellations/MarkSentDialog';
import { groupByRecipient, recipientKey } from '@/components/interpellations/recipients';
import { sortByUrgency } from '@/components/interpellations/urgency';
import { useInterpellationMetrics } from '@/hooks/useInterpellationMetrics';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useModuleNarrow } from '@/hooks/useModuleNarrow';
import { useInterpellations } from '@/hooks/useInterpellations';
import { useMpForms } from '@/hooks/useMpForms';
import type { InterpellationListItem, InterpellationStatus } from '@/integrations/supabase/types';

/** 'decision' = czeka na decyzję Posła (nowa i po poprawkach); ustawiany z paska "Wymaga działania". */
type StatusFilter = 'active' | 'all' | 'decision' | InterpellationStatus;

interface AttentionItem {
  filter: StatusFilter;
  label: string;
  count: number;
  icon: LucideIcon;
  /** Dopisek alarmowy, np. liczba po terminie wysłania. */
  alert?: string;
}

const LAYOUT_STORAGE_KEY = 'app:interpelacje:layout';
const GROUP_STORAGE_KEY = 'app:interpelacje:groupByRecipient';

function readLayoutPreference(): InterpellationsLayout {
  try {
    const stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    return INTERPELLATION_LAYOUTS.find((l) => l === stored) ?? 'list';
  } catch {
    return 'list';
  }
}

function readGroupPreference(): boolean {
  try {
    return window.localStorage.getItem(GROUP_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function Interpelacje() {
  const { profile } = useAuth();
  const writer = canWrite(profile?.role);
  const admin = isAdmin(profile?.role);
  // Interpelacje wgrywa Pracownik (ręcznie albo przez Claude/MCP) - jak role narzędzi MCP.
  const uploader = profile?.role === 'pracownik';
  const navigate = useNavigate();
  const [uploadOpen, setUploadOpen] = useState(false);
  const { data: items = [], isLoading } = useInterpellations();
  const { data: metrics, isLoading: metricsLoading } = useInterpellationMetrics();
  const [layout, setLayout] = useState<InterpellationsLayout>(readLayoutPreference);
  // Wąski obszar modułu (telefon albo otwarty PoliAI): zawsze lista; zapisana preferencja
  // (tablica/kalendarz) wraca, gdy jest miejsce.
  const isMobile = useIsMobile();
  const moduleNarrow = useModuleNarrow('md');
  const viewLayout: InterpellationsLayout = moduleNarrow ? 'list' : layout;
  const [groupByRecipientOn, setGroupByRecipientOn] = useState(readGroupPreference);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [recipientFilter, setRecipientFilter] = useState<string | null>(null);
  const [monthDate, setMonthDate] = useState<Date>(() => new Date());
  const [deleting, setDeleting] = useState<InterpellationListItem | null>(null);
  const [markingSent, setMarkingSent] = useState<InterpellationListItem | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
      window.localStorage.setItem(GROUP_STORAGE_KEY, groupByRecipientOn ? '1' : '0');
    } catch {
      // Brak dostępu do localStorage (tryb prywatny) - preferencje tylko w sesji.
    }
  }, [layout, groupByRecipientOn]);

  const mp = useMpForms();
  const recipients = useMemo(() => groupByRecipient(items), [items]);
  // Odbiorca mógł zniknąć z danych (usunięcie) - wtedy filtr nie obowiązuje.
  const activeRecipient = recipients.some((r) => r.key === recipientFilter) ? recipientFilter : null;

  const byRecipient = useMemo(
    () => (activeRecipient ? items.filter((it) => recipientKey(it.recipient) === activeRecipient) : items),
    [items, activeRecipient],
  );

  const counts = useMemo(() => {
    const byStatus: Record<InterpellationStatus, number> = {
      nowa: 0,
      uwagi: 0,
      po_poprawkach: 0,
      zaakceptowana: 0,
      wyslana: 0,
      odrzucona: 0,
    };
    let active = 0;
    let overdue = 0;
    const now = new Date();
    for (const it of byRecipient) {
      byStatus[it.status] += 1;
      if (!isTerminal(it.status)) active += 1;
      if (it.status === 'zaakceptowana' && it.deadline_at && deadlineState(it.deadline_at, now) === 'overdue') {
        overdue += 1;
      }
    }
    return { active, overdue, byStatus };
  }, [byRecipient]);

  const visible = useMemo(() => {
    if (statusFilter === 'active') return sortByUrgency(byRecipient.filter((it) => !isTerminal(it.status)));
    if (statusFilter === 'decision') return sortByUrgency(byRecipient.filter((it) => isAwaitingDecision(it.status)));
    const filtered = statusFilter === 'all' ? byRecipient : byRecipient.filter((it) => it.status === statusFilter);
    // Etapy w toku wg pilności (zaakceptowane wg terminu wysłania); zakończone i "Wszystkie" od najnowszych.
    if (statusFilter !== 'all' && !isTerminal(statusFilter)) return sortByUrgency(filtered);
    return [...filtered].sort(
      (a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime(),
    );
  }, [byRecipient, statusFilter]);

  const visibleGroups = useMemo(
    () => (groupByRecipientOn ? groupByRecipient(visible) : []),
    [groupByRecipientOn, visible],
  );

  const tabs: { value: StatusFilter; label: string; count: number; status?: InterpellationStatus }[] = [
    { value: 'active', label: 'W toku', count: counts.active },
    ...INTERPELLATION_STATUSES.map((status) => ({
      value: status,
      label: status === 'odrzucona' ? 'Archiwum' : INTERPELLATION_STATUS_SHORT[status],
      count: counts.byStatus[status],
      status,
    })),
    { value: 'all', label: 'Wszystkie', count: byRecipient.length },
  ];

  // Etapy wymagające działania roli (liczone dla całego biura, jak na Pulpicie): Poseł decyduje,
  // Pracownik poprawia i wysyła (Poseł też może potwierdzić wysyłkę).
  const attention: AttentionItem[] = [
    ...(admin
      ? [{
          filter: 'decision' as const,
          label: 'Czeka na Twoją decyzję',
          count: counts.byStatus.nowa + counts.byStatus.po_poprawkach,
          icon: FileCheck2,
        }]
      : []),
    ...(writer
      ? [{
          filter: 'zaakceptowana' as const,
          label: 'Do wysłania',
          count: counts.byStatus.zaakceptowana,
          icon: Send,
          alert: counts.overdue > 0 ? `${counts.overdue} po terminie` : undefined,
        }]
      : []),
    ...(writer && !admin
      ? [{ filter: 'uwagi' as const, label: 'Do poprawy', count: counts.byStatus.uwagi, icon: MessageSquareText }]
      : []),
    // Aktywny filtr zostaje widoczny także po spadku licznika do zera (np. decyzja w innej karcie).
  ].filter((item) => item.count > 0 || statusFilter === item.filter);

  const filteredOut = statusFilter !== 'all' || activeRecipient !== null;
  const showAll = () => {
    setStatusFilter('all');
    setRecipientFilter(null);
  };

  const emptyState = (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <FileText className="h-5 w-5" />
      </div>
      <p className="max-w-md text-sm text-muted-foreground">
        {items.length === 0
          ? INSTANCE.ai
            ? 'Brak interpelacji. Pracownik dodaje je w portalu albo wgrywa przez Claude połączone z portalem biura przez MCP.'
            : 'Brak interpelacji. Pracownik dodaje je przyciskiem „Dodaj interpelację”.'
          : statusFilter === 'active' && activeRecipient === null
            ? 'Brak interpelacji w toku.'
            : 'Brak interpelacji w wybranym widoku.'}
      </p>
      {items.length === 0 && (uploader || (writer && INSTANCE.ai)) ? (
        <div className="flex flex-wrap justify-center gap-2">
          {uploader && (
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Plus />
              Dodaj interpelację
            </Button>
          )}
          {writer && INSTANCE.ai && (
            // Integracje MCP są tylko na desktopie - na telefonie bez odnośnika.
            <Button size="sm" variant="outline" className="max-md:hidden" asChild>
              <Link to="/biuro/admin/integracje/mcp">
                <Plug />
                Podłącz Claude przez MCP
              </Link>
            </Button>
          )}
        </div>
      ) : items.length > 0 && filteredOut ? (
        <Button variant="outline" size="sm" onClick={showAll}>
          Pokaż wszystkie
        </Button>
      ) : null}
    </div>
  );

  return (
    <Page>
      <PageHeader
        icon={FileText}
        title="Interpelacje"
        // Opis obiegu tylko przy szerokim obszarze modułu; na telefonie zabierałby trzy linie nad listą.
        description={
          <span className="@max-md:hidden">
            {INSTANCE.ai ? 'Pracownik dodaje interpelację w portalu albo wgrywa ją przez Claude (MCP).' : 'Pracownik dodaje interpelację w portalu.'}{' '}
            {mp.nominative} akceptuje ją, zgłasza uwagi albo odrzuca; zaakceptowana czeka na wysłanie.
          </span>
        }
        titleAddon={<ModuleOwners module="interpelacje" />}
        actions={
          uploader && (
            <Button onClick={() => setUploadOpen(true)}>
              <Plus />
              <span className="@max-sm:hidden">Dodaj interpelację</span>
            </Button>
          )
        }
        toolbar={
          <>
            <InterpellationViewTabs value={layout} onChange={setLayout} />
            {/* Poniżej @md zakładek widoku nie ma - filtr zajmuje cały wiersz zamiast wisieć przy prawej krawędzi. */}
            <div className="flex w-full items-center gap-2 @md:ml-auto @md:w-auto">
              <SearchSelect
                aria-label="Odbiorca"
                className="flex-1 @md:w-60 @md:flex-none"
                value={activeRecipient}
                onChange={setRecipientFilter}
                noneLabel="Wszyscy odbiorcy"
                placeholder="Wszyscy odbiorcy"
                options={recipients.map((r) => ({
                  value: r.key,
                  label: r.label,
                  description: `Interpelacje: ${r.items.length}`,
                }))}
              />
              {viewLayout === 'list' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="default"
                  aria-pressed={groupByRecipientOn}
                  aria-label="Grupuj wg odbiorcy"
                  title="Grupuj wg odbiorcy"
                  onClick={() => setGroupByRecipientOn((v) => !v)}
                  className={cn(
                    'shrink-0 gap-1.5 px-3 @max-sm:w-11 @max-sm:px-0',
                    groupByRecipientOn && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
                  )}
                >
                  <Layers />
                  <span className="@max-sm:hidden">Grupuj wg odbiorcy</span>
                </Button>
              )}
              {viewLayout === 'calendar' ? (
                <MonthNav monthDate={monthDate} onChange={setMonthDate} />
              ) : (
                !isLoading && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-live="polite">
                    {viewLayout === 'list' ? visible.length : byRecipient.length} z {items.length}
                  </span>
                )
              )}
            </div>
          </>
        }
      />

      {/* Wskaźniki szybkości obiegu: mało przydatne na telefonie, tylko desktop. */}
      {!isMobile && <InterpellationMetrics data={metrics} loading={metricsLoading} />}

      {viewLayout === 'list' && attention.length > 0 && (
        <div role="group" aria-label="Wymaga działania" className="grid gap-2 @sm:flex @sm:flex-wrap">
          {attention.map(({ filter, label, count, icon: Icon, alert }) => {
            const active = statusFilter === filter;
            return (
              <button
                key={filter}
                type="button"
                aria-pressed={active}
                aria-label={`${label}: ${count}${alert ? `, w tym ${alert}` : ''}`}
                onClick={() => setStatusFilter(active ? 'active' : filter)}
                className={cn(
                  'flex min-h-12 items-center gap-3 rounded-xl border bg-card px-3 text-left text-sm shadow-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-10',
                  active ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/60',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                    alert ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
                  )}
                  aria-hidden
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 font-medium">
                  {label}
                  {alert && <span className="ml-2 text-xs font-medium text-destructive">{alert}</span>}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {viewLayout === 'list' && (
        // Na wąskim ekranie etapy przewijają się w poziomie; wygaszona prawa krawędź sygnalizuje, że jest ich więcej.
        <div
          role="group"
          aria-label="Filtr etapu"
          className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 md:gap-1 @max-md:pr-8 @max-md:[mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)]"
        >
          {tabs.map((tab) => {
            const active = statusFilter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                aria-pressed={active}
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {tab.status && (
                  <span
                    className={cn('h-1.5 w-1.5 rounded-full', INTERPELLATION_STATUS_DOT[tab.status])}
                    aria-hidden
                  />
                )}
                {tab.label}
                <span className="tabular-nums text-xs opacity-70">{tab.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {!isLoading && items.length === 0 ? (
        emptyState
      ) : viewLayout === 'board' ? (
        <InterpellationsBoard
          items={byRecipient}
          isLoading={isLoading}
          writer={writer}
          admin={admin}
          onMarkSent={setMarkingSent}
          onDelete={setDeleting}
        />
      ) : viewLayout === 'calendar' ? (
        <InterpellationsCalendar monthDate={monthDate} items={byRecipient} isLoading={isLoading} />
      ) : groupByRecipientOn && !isLoading && visible.length > 0 ? (
        <div className="space-y-5">
          {visibleGroups.map((group) => (
            <section key={group.key} aria-label={`Odbiorca: ${group.label}`} className="space-y-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                {group.label}
                <span className="text-xs font-normal tabular-nums text-muted-foreground">
                  {group.items.length}
                </span>
              </h2>
              <InterpellationsList
                items={group.items}
                isLoading={false}
                onMarkSent={setMarkingSent}
                onDelete={setDeleting}
                emptyState={null}
              />
            </section>
          ))}
        </div>
      ) : (
        <InterpellationsList
          items={visible}
          isLoading={isLoading}
          onMarkSent={setMarkingSent}
          onDelete={setDeleting}
          emptyState={emptyState}
        />
      )}

      <MarkSentDialog item={markingSent} onClose={() => setMarkingSent(null)} />
      <DeleteInterpellationDialog item={deleting} onClose={() => setDeleting(null)} />
      <InterpellationUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSaved={(id) => navigate(`/biuro/interpelacje/${id}`)}
      />
    </Page>
  );
}

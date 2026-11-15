import { useMemo, useState } from 'react';
import { ChevronRight, FileDown, History, Loader2, Search, X } from 'lucide-react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Page, PageHeader } from '@/components/layout/Page';
import { Pagination } from '@/components/common/Pagination';
import {
  CodeBlock,
  EmptyState,
  LIST_PANEL,
  ListSkeleton,
  StatusPill,
  type PillTone,
} from '@/components/admin/AdminUi';

import { useAuditLog, fetchAuditLogForReport } from '@/hooks/useAuditLog';
import { useSiteContent } from '@/hooks/useSiteContent';
import { openPrintHtml } from '@/lib/printDocument';
import { buildAuditReport } from '@/lib/reports';
import type { AuditLog } from '@/integrations/supabase/types';

const ACTION_OPTIONS = [
  { value: 'all', label: 'Wszystkie akcje' },
  { value: 'user.', label: 'Użytkownicy (wszystkie)' },
  { value: 'office.', label: 'Biura (wszystkie)' },
  { value: 'contact.', label: 'Kontakty (wszystkie)' },
  { value: 'case.', label: 'Sprawy (wszystkie)' },
  { value: 'event.', label: 'Kalendarz (wszystkie)' },
  { value: 'interpellation.', label: 'Interpelacje (wszystkie)' },
];

const ENTITY_OPTIONS = [
  { value: 'all', label: 'Wszystkie typy' },
  { value: 'profile', label: 'Profil' },
  { value: 'office', label: 'Biuro' },
  { value: 'contact', label: 'Kontakt' },
  { value: 'case', label: 'Sprawa' },
  { value: 'event', label: 'Wydarzenie' },
  { value: 'interpellation', label: 'Interpelacja' },
];

function actionTone(action: string): PillTone {
  if (action.endsWith('.create')) return 'success';
  if (action.endsWith('.delete')) return 'danger';
  if (action.endsWith('.status_change')) return 'warning';
  if (action.endsWith('.update')) return 'info';
  return 'neutral';
}

function MetadataPreview({ meta }: { meta: Record<string, unknown> }) {
  return (
    <details className="group/meta mt-1.5">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md py-0.5 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open/meta:rotate-90" />
        Szczegóły zmian ({Object.keys(meta).length})
      </summary>
      <CodeBlock className="mt-1.5 max-h-80">{JSON.stringify(meta, null, 2)}</CodeBlock>
    </details>
  );
}

export default function AuditLogPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const monthAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);

  const [from, setFrom] = useState<string>(monthAgo);
  const [to, setTo] = useState<string>(today);
  const [action, setAction] = useState<string>('all');
  const [entityType, setEntityType] = useState<string>('all');
  const [userEmail, setUserEmail] = useState<string>('');
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  const filters = {
    from: from || null,
    to: to || null,
    action: action === 'all' ? null : action,
    entityType: entityType === 'all' ? null : entityType,
    userEmail: userEmail.trim() || null,
    page,
    pageSize: 50,
  };

  const { data, isLoading } = useAuditLog(filters);
  const { data: site } = useSiteContent();
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const handleExport = async () => {
    setExporting(true);
    try {
      const allRows = await fetchAuditLogForReport(filters);
      const report = buildAuditReport({
        rows: allRows,
        filters: {
          from: filters.from,
          to: filters.to,
          action: filters.action,
          entityType: filters.entityType,
          userEmail: filters.userEmail,
        },
      });
      openPrintHtml({ title: report.title, subtitle: report.subtitle, bodyHtml: report.bodyHtml, identity: site?.identity });
      if (allRows.length === 2000) {
        toast.warning('Limit raportu', { description: 'Zwrócono 2000 najnowszych wpisów. Zawęź zakres dat, aby objąć wszystkie.' });
      }
    } catch (err) {
      toast.error('Nie udało się wygenerować raportu', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    } finally {
      setExporting(false);
    }
  };

  const resetFilters = () => {
    setFrom(monthAgo);
    setTo(today);
    setAction('all');
    setEntityType('all');
    setUserEmail('');
    setPage(0);
  };

  const toolbar = (
    <>
      <div className="flex items-center gap-1.5">
        <Label htmlFor="from" className="sr-only">Od</Label>
        <Input
          id="from"
          type="date"
          className="h-9 w-[9.5rem]"
          value={from}
          onChange={(e) => { setFrom(e.target.value); setPage(0); }}
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Label htmlFor="to" className="sr-only">Do</Label>
        <Input
          id="to"
          type="date"
          className="h-9 w-[9.5rem]"
          value={to}
          onChange={(e) => { setTo(e.target.value); setPage(0); }}
        />
      </div>
      <Select value={action} onValueChange={(v) => { setAction(v); setPage(0); }}>
        <SelectTrigger className="h-9 w-auto min-w-[10.5rem]" aria-label="Akcja"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ACTION_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={entityType} onValueChange={(v) => { setEntityType(v); setPage(0); }}>
        <SelectTrigger className="h-9 w-auto min-w-[9.5rem]" aria-label="Typ encji"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ENTITY_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="relative min-w-[12rem] flex-1 @sm:max-w-xs">
        <Label htmlFor="userEmail" className="sr-only">Email użytkownika</Label>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="userEmail"
          className="h-9 pl-8"
          placeholder="Email użytkownika, np. anna@..."
          value={userEmail}
          onChange={(e) => { setUserEmail(e.target.value); setPage(0); }}
        />
      </div>
      <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">
        <X />
        Wyczyść filtry
      </Button>
    </>
  );

  return (
    <Page>
      <PageHeader
        icon={History}
        title="Dziennik zmian"
        description="Ślad akcji w systemie. Wpisy generowane automatycznie przez triggery DB i Edge Functions."
        actions={
          <Button variant="outline" onClick={handleExport} disabled={exporting || isLoading}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown />}
            Eksportuj PDF
          </Button>
        }
        toolbar={toolbar}
      />

      <div className="space-y-2">
        <p className="px-1 text-xs font-medium text-muted-foreground">
          {isLoading ? 'Wczytywanie...' : `Wpisy: ${total}`}
        </p>

        <div className={LIST_PANEL}>
          {isLoading ? (
            <ListSkeleton rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState icon={History} title="Brak wpisów w wybranym zakresie." />
          ) : (
            <ul className="divide-y">
              {rows.map((r: AuditLog) => (
                <li key={r.id} className="px-3 py-2.5 transition-colors hover:bg-muted/60 sm:px-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <StatusPill tone={actionTone(r.action)} className="font-mono">{r.action}</StatusPill>
                    <span className="min-w-0 break-all text-sm font-medium">
                      {r.user_email ?? <span className="font-normal text-muted-foreground">System</span>}
                    </span>
                    {r.entity_type && (
                      <span className="text-xs text-muted-foreground">
                        {r.entity_type}
                        {r.entity_id && <span className="ml-1 font-mono">#{r.entity_id.slice(0, 8)}</span>}
                      </span>
                    )}
                    <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {format(new Date(r.created_at), 'd MMM yyyy, HH:mm', { locale: pl })}
                    </span>
                  </div>
                  {r.metadata && Object.keys(r.metadata).length > 0 && (
                    <MetadataPreview meta={r.metadata} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Pagination
        page={page}
        total={total}
        pageSize={50}
        onChange={(p) => {
          setPage(p);
          document.getElementById('app-main')?.scrollTo({ top: 0 });
        }}
      />
    </Page>
  );
}

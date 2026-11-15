import { useEffect, useRef, useState } from 'react';
import { Briefcase, FileDown, Layers, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Page, PageHeader } from '@/components/layout/Page';
import { useAuth } from '@/contexts/AuthContext';
import { canWrite } from '@/lib/permissions';
import { CasesFilters, EMPTY_CASES_FILTERS } from '@/components/cases/CasesFilters';
import { CasesList } from '@/components/cases/CasesList';
import type { CasesSort } from '@/components/cases/CasesColumnsHeader';
import { CaseFormDialog } from '@/components/cases/CaseFormDialog';
import { CaseDetailsDialog } from '@/components/cases/CaseDetailsDialog';
import { DeleteCaseDialog } from '@/components/cases/DeleteCaseDialog';
import { defaultCasesFilters, useCase, useCases, type CasesFilters as Filters } from '@/hooks/useCases';
import { useOpenParam } from '@/hooks/useOpenParam';
import { useSiteContent } from '@/hooks/useSiteContent';
import type { CaseWithRelations } from '@/integrations/supabase/types';
import { openPrintHtml } from '@/lib/printDocument';
import { buildCasesReport } from '@/lib/reports';
import { cn } from '@/lib/utils';

const GROUP_STORAGE_KEY = 'app:sprawy:groupByStatus';

function readGroupPreference(): boolean {
  try {
    return window.localStorage.getItem(GROUP_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function Sprawy() {
  const { profile } = useAuth();
  const writer = canWrite(profile?.role);
  const [filters, setFilters] = useState<Filters>(() => defaultCasesFilters(profile));
  const [sort, setSort] = useState<CasesSort>('created');
  const [groupByStatus, setGroupByStatus] = useState(readGroupPreference);
  const [formOpen, setFormOpen] = useState(false);
  const [previewing, setPreviewing] = useState<CaseWithRelations | null>(null);
  const [deleting, setDeleting] = useState<CaseWithRelations | null>(null);
  const { data: cases = [], isLoading } = useCases(filters);
  const { data: site } = useSiteContent();

  // Deep-link `?open=<id>` (wyszukiwarka globalna): rekord z listy albo pobrany po id.
  const [openId, clearOpen] = useOpenParam();
  const listed = openId ? (cases.find((c) => c.id === openId) ?? null) : null;
  const lookupId = openId && !isLoading && !listed ? openId : null;
  const lookup = useCase(lookupId);
  const target = listed ?? lookup.data ?? null;
  const notFound = Boolean(lookupId) && (lookup.isError || (lookup.isSuccess && !lookup.data));
  const handledOpenId = useRef<string | null>(null);

  useEffect(() => {
    if (!openId) {
      handledOpenId.current = null;
      return;
    }
    if (handledOpenId.current === openId) return;
    if (target) {
      handledOpenId.current = openId;
      setPreviewing(target);
    } else if (notFound) {
      handledOpenId.current = openId;
      toast.error('Nie znaleziono sprawy', {
        description: 'Mogła zostać usunięta lub nie masz do niej dostępu.',
      });
      clearOpen();
    }
  }, [openId, target, notFound, clearOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem(GROUP_STORAGE_KEY, groupByStatus ? '1' : '0');
    } catch {
      // Brak dostępu do localStorage (tryb prywatny) - preferencja tylko w sesji.
    }
  }, [groupByStatus]);

  // Świeża wersja podglądanej sprawy (edycja w miejscu, przepisanie): własne zapytanie po id,
  // bo po zmianie np. statusu sprawa może wypaść z przefiltrowanej listy. Do czasu odpowiedzi - z listy.
  const previewDetail = useCase(previewing?.id ?? null);
  const previewCase = previewing
    ? (previewDetail.data ?? cases.find((c) => c.id === previewing.id) ?? previewing)
    : null;

  const closePreview = () => {
    setPreviewing(null);
    if (openId) clearOpen();
  };

  const handleAdd = () => setFormOpen(true);

  const handleDeleteFromPreview = (c: CaseWithRelations) => {
    closePreview();
    setDeleting(c);
  };

  const handleExport = () => {
    const report = buildCasesReport({
      rows: cases,
      filters: {
        status: filters.status,
        priority: filters.priority,
        categoryId: filters.categoryId,
        assignedTo: filters.assignedTo,
        search: filters.search,
      },
    });
    openPrintHtml({ title: report.title, subtitle: report.subtitle, bodyHtml: report.bodyHtml, identity: site?.identity });
  };

  const filtered =
    !!filters.status || !!filters.priority || !!filters.categoryId || !!filters.assignedTo ||
    !!filters.source || (filters.search ?? '').length > 0;

  return (
    <Page>
      <PageHeader
        icon={Briefcase}
        title="Sprawy wyborców"
        description="Rejestrowanie i obsługa zgłoszeń kierowanych do biura."
        actions={
          <>
            <Button variant="outline" disabled={isLoading || cases.length === 0} onClick={handleExport}>
              <FileDown />
              Eksportuj PDF
            </Button>
            {writer && (
              <Button onClick={handleAdd}>
                <Plus />
                Dodaj sprawę
              </Button>
            )}
          </>
        }
        toolbar={
          <>
            <CasesFilters value={filters} onChange={setFilters} />
            {/* Poniżej @xl filtry zawijają się w kilka rzędów - grupowanie i licznik w osobnym, pełnym rzędzie. */}
            <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 @xl:ml-auto @xl:w-auto @xl:justify-end">
              <span className="whitespace-nowrap text-xs text-muted-foreground" aria-live="polite">
                {isLoading
                  ? 'Wczytywanie...'
                  : `Znaleziono: ${cases.length}${cases.length >= 200 ? ' (limit 200)' : ''}`}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={groupByStatus}
                onClick={() => setGroupByStatus((v) => !v)}
                className={cn('rounded-full', groupByStatus && 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}
              >
                <Layers />
                Grupuj wg statusu
              </Button>
            </div>
          </>
        }
      />

      <CasesList
        cases={cases}
        isLoading={isLoading}
        groupByStatus={groupByStatus}
        filters={filters}
        onFiltersChange={setFilters}
        sort={sort}
        onSortChange={setSort}
        emptyMessage={filtered ? 'Brak spraw dla wybranych filtrów.' : 'Nie ma jeszcze żadnych spraw.'}
        emptyAction={
          filtered ? (
            <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_CASES_FILTERS)}>
              Wyczyść filtry
            </Button>
          ) : writer ? (
            <Button size="sm" onClick={handleAdd}>
              <Plus />
              Dodaj sprawę
            </Button>
          ) : undefined
        }
        onPreview={setPreviewing}
        onDelete={setDeleting}
      />

      <CaseFormDialog open={formOpen} onOpenChange={setFormOpen} />
      <CaseDetailsDialog case_={previewCase} onClose={closePreview} onDelete={handleDeleteFromPreview} />
      <DeleteCaseDialog case_={deleting} onClose={() => setDeleting(null)} />
    </Page>
  );
}

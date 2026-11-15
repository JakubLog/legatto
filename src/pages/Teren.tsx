import { lazy, Suspense, useState } from 'react';
import { FileDown, MapPinned, Settings as SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Page, PageHeader } from '@/components/layout/Page';
import { ModuleOwners } from '@/components/common/ModuleOwners';
import { useAuth } from '@/contexts/AuthContext';
import { isAdmin } from '@/lib/permissions';
import { useAppSetting } from '@/hooks/useAppSetting';
import { usePowiatVisibility } from '@/hooks/usePowiatVisibility';
import { useSiteContent } from '@/hooks/useSiteContent';
import { VisibilityTable } from '@/components/visibility/VisibilityTable';
import { VisibilitySummary } from '@/components/visibility/VisibilitySummary';
import { VisibilityMapSkeleton } from '@/components/visibility/VisibilityMapSkeleton';
import { VisibilitySettingsDialog } from '@/components/visibility/VisibilitySettingsDialog';
import { openPrintHtml } from '@/lib/printDocument';
import { buildVisibilityReport } from '@/lib/reports';

const VisibilityMap = lazy(() =>
  import('@/components/visibility/VisibilityMap').then((m) => ({ default: m.VisibilityMap })),
);

const DEFAULT_THRESHOLD = 90;

export default function Teren() {
  const { profile } = useAuth();
  const admin = isAdmin(profile?.role);

  const { data: thresholdRaw } = useAppSetting<number>('visibility_alert_days', DEFAULT_THRESHOLD);
  const threshold = typeof thresholdRaw === 'number' ? thresholdRaw : DEFAULT_THRESHOLD;

  const { data: stats = [], isLoading } = usePowiatVisibility();
  const { data: site } = useSiteContent();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleExport = () => {
    const report = buildVisibilityReport({
      stats,
      thresholds: {
        warningDays: Math.round(threshold / 2),
        criticalDays: threshold,
      },
    });
    openPrintHtml({ title: report.title, subtitle: report.subtitle, bodyHtml: report.bodyHtml, identity: site?.identity });
  };

  return (
    <Page>
      <PageHeader
        icon={MapPinned}
        title="Widoczność w terenie"
        titleAddon={<ModuleOwners module="teren" />}
        description={`Kontakty i spotkania/wyjazdy per powiat · alert po ${threshold} dniach bez obecności`}
        actions={
          <>
            <Button variant="outline" size="sm" disabled={isLoading || stats.length === 0} onClick={handleExport}>
              <FileDown />
              Eksportuj PDF
            </Button>
            {/* Konfiguracja progu pozostaje funkcją desktopową. */}
            {admin && (
              <Button variant="outline" size="sm" className="max-md:hidden" onClick={() => setSettingsOpen(true)}>
                <SettingsIcon />
                Ustawienia
              </Button>
            )}
          </>
        }
      />

      <VisibilitySummary stats={stats} isLoading={isLoading} thresholdDays={threshold} />

      {/* Szeroki obszar modułu: mapa obok tabeli zamiast mapy wyśrodkowanej w pustej, pełnej szerokości karcie. */}
      <div className="grid gap-5 @xl:grid-cols-2 @xl:items-start">
        <Suspense fallback={<VisibilityMapSkeleton />}>
          <VisibilityMap thresholdDays={threshold} />
        </Suspense>

        <VisibilityTable stats={stats} isLoading={isLoading} thresholdDays={threshold} />
      </div>

      <VisibilitySettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        currentDays={threshold}
      />
    </Page>
  );
}

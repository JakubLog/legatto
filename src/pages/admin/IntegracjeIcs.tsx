import { CalendarDays } from 'lucide-react';

import { Page, PageHeader } from '@/components/layout/Page';
import { BackToIntegrations } from '@/components/admin/BackToIntegrations';
import { IcsSourcesSection } from '@/components/admin/IcsSourcesSection';

export default function AdminIntegracjeIcs() {
  return (
    <Page narrow>
      <BackToIntegrations />
      <PageHeader
        icon={CalendarDays}
        title="Kalendarze zewnętrzne (ICS)"
        description={
          <>
            Importuj zdarzenia z zewnętrznych kalendarzy (Google, Apple, Outlook) przez prywatny
            link ICS. Synchronizacja ręczna — kliknij <strong>Synchronizuj</strong>, aby
            zaktualizować wydarzenia w systemie.
          </>
        }
      />

      <IcsSourcesSection />
    </Page>
  );
}

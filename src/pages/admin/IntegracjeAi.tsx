import { Sparkles } from 'lucide-react';

import { Page, PageHeader } from '@/components/layout/Page';
import { BackToIntegrations } from '@/components/admin/BackToIntegrations';
import { AiSettingsCard } from '@/components/admin/AiSettingsCard';
import { useMpForms } from '@/hooks/useMpForms';

export default function IntegracjeAi() {
  const mp = useMpForms();
  return (
    <Page narrow>
      <BackToIntegrations />
      <PageHeader
        icon={Sparkles}
        title="AI (Claude)"
        description={
          <>
            Funkcje AI w systemie korzystają z kredytów API dołączonych do planu <strong>Claude Max</strong>{' '}
            {mp.genitive}, a nie z osobno opłacanego konta API.
          </>
        }
      />

      <AiSettingsCard />
    </Page>
  );
}

import { Sparkles } from 'lucide-react';

import { Page, PageHeader } from '@/components/layout/Page';
import { BackToIntegrations } from '@/components/admin/BackToIntegrations';
import { AiSettingsCard } from '@/components/admin/AiSettingsCard';
import { useAiConnection } from '@/hooks/useAi';
import { useMpForms } from '@/hooks/useMpForms';

export default function IntegracjeAi() {
  const mp = useMpForms();
  // To samo zapytanie co w AiSettingsCard (wspólny cache) - bez dodatkowego żądania.
  const operatorKey = useAiConnection().data?.operator_managed.key === true;
  return (
    <Page narrow>
      <BackToIntegrations />
      <PageHeader
        icon={Sparkles}
        title="AI (Claude)"
        description={
          operatorKey ? (
            'Funkcje AI w systemie korzystają z klucza API Claude ustawionego przez operatora instancji.'
          ) : (
            <>
              Funkcje AI w systemie korzystają z kredytów API dołączonych do planu <strong>Claude Max</strong>{' '}
              {mp.genitive}, a nie z osobno opłacanego konta API.
            </>
          )
        }
      />

      <AiSettingsCard />
    </Page>
  );
}

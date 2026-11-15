import { Mail } from 'lucide-react';

import { Page, PageHeader } from '@/components/layout/Page';
import { BackToIntegrations } from '@/components/admin/BackToIntegrations';
import { GetResponseSettingsCard } from '@/components/admin/GetResponseSettingsCard';
import { NewsletterDefaultsCard } from '@/components/admin/NewsletterDefaultsCard';

export default function IntegracjeGetResponse() {
  return (
    <Page narrow>
      <BackToIntegrations />
      <PageHeader
        icon={Mail}
        title="GetResponse"
        description={
          <>
            Klucz API, domyślna lista odbiorców i adres nadawcy. Wykorzystywane przez moduł{' '}
            <strong>Kampanie e-mail</strong> w zakładce Kontakty.
          </>
        }
      />

      <GetResponseSettingsCard />
      <NewsletterDefaultsCard />
    </Page>
  );
}

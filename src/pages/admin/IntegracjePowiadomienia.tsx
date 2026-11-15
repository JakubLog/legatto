import { Bell } from 'lucide-react';

import { Page, PageHeader } from '@/components/layout/Page';
import { BackToIntegrations } from '@/components/admin/BackToIntegrations';
import {
  DispatchStatusCard,
  NotificationsSettingsCard,
  ResendKeyCard,
} from '@/components/notifications/NotificationsAdminCard';
import { NotificationDeliveriesCard } from '@/components/notifications/NotificationDeliveriesCard';

export default function IntegracjePowiadomienia() {
  return (
    <Page narrow>
      <BackToIntegrations />
      <PageHeader
        icon={Bell}
        title="Powiadomienia"
        description="E-mail (Resend) i powiadomienia push dla całego biura"
      />

      <ResendKeyCard />
      <NotificationsSettingsCard />
      <DispatchStatusCard />
      <NotificationDeliveriesCard limit={50} />
    </Page>
  );
}

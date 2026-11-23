import { ExternalLink, LayoutTemplate } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Page, PageHeader } from '@/components/layout/Page';
import { ErrorNotice, SettingsCardSkeleton } from '@/components/admin/AdminUi';
import { HomepageEditor } from '@/components/admin/homepage/HomepageEditor';
import { SitePublishCard } from '@/components/admin/homepage/SitePublishCard';
import { useSiteContent } from '@/hooks/useSiteContent';
import { usePublicSiteUrl } from '@/hooks/useSitePublish';

/** Edycja publicznej strony głównej (`/`) - Poseł i Administrator. */
export default function AdminStronaGlowna() {
  const siteQ = useSiteContent();
  const publicSiteUrl = usePublicSiteUrl().data ?? '';

  return (
    <Page narrow>
      <PageHeader
        icon={LayoutTemplate}
        title="Strona główna"
        description={
          publicSiteUrl
            ? 'Treść i wygląd strony posła: dane posła, szablon i kolor, hero, sekcje, menu i stopka. Zapisane zmiany trafiają na stronę po publikacji.'
            : 'Treść i wygląd publicznej strony biura: dane posła, szablon i kolor, hero, sekcje, menu i stopka. Zmiany są widoczne od razu po zapisie.'
        }
        actions={
          <Button asChild variant="outline">
            <a href="/?podglad" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              {publicSiteUrl ? 'Podgląd strony' : 'Otwórz stronę główną'}
            </a>
          </Button>
        }
      />

      <div className="space-y-4">
        <SitePublishCard />

        {siteQ.error ? (
          <ErrorNotice title="Błąd odczytu treści strony" message={siteQ.error.message} />
        ) : siteQ.data ? (
          <HomepageEditor initial={siteQ.data} />
        ) : (
          <>
            <SettingsCardSkeleton label="Ładuję treść strony..." fields={6} />
            <SettingsCardSkeleton label="Ładuję treść strony..." fields={4} />
          </>
        )}
      </div>
    </Page>
  );
}

import { useEffect } from 'react';
import { PublicCalendarSection } from '@/components/public/PublicCalendarSection';
import { PublicHome, type PublicHomeSlots } from '@/components/public/PublicHome';
import { PublicOfficeCard } from '@/components/public/PublicOfficeCard';
import type { DistrictGeo } from '@/components/public/PublicOfficesMap';
import { PublicPageSkeleton } from '@/components/public/PublicPageSkeleton';
import { PublicSubmissionForm } from '@/components/public/PublicSubmissionForm';
import { useDistrictGeo } from '@/hooks/useDistrict';
import { EMPTY_PUBLIC_SITE, usePublicSite } from '@/hooks/usePublicSite';
import { edgeSubmissionStrategy } from '@/lib/publicSubmitEdge';

// Strona główna SPA (tryb Vercel i podgląd w CRM): dane z GET /api/public-site, formularz przez
// funkcję brzegową public-submit-case. Strona statyczna posła renderuje ten sam PublicHome w site/.

const SLOTS: PublicHomeSlots = {
  calendar: (props) => <PublicCalendarSection {...props} />,
  officeCard: (props) => <PublicOfficeCard {...props} />,
  submitForm: (props) => <PublicSubmissionForm {...props} strategy={edgeSubmissionStrategy} />,
};

/** Granice okręgu z public/geo/ (cache wspólny z mapami portalu); `null` = brak okręgu/plików. */
function useHomeGeo(districtNumber: number | null | undefined, enabled: boolean): DistrictGeo | null | undefined {
  const number = enabled ? districtNumber : null;
  const powiatyQ = useDistrictGeo(number, 'powiaty');
  const gminyQ = useDistrictGeo(number, 'gminy');
  if (number == null || powiatyQ.isError || gminyQ.isError) return null;
  if (powiatyQ.data === undefined || gminyQ.data === undefined) return undefined;
  return powiatyQ.data && gminyQ.data ? { powiaty: powiatyQ.data, gminy: gminyQ.data } : null;
}

export default function HomePage() {
  const siteQ = usePublicSite();
  const site = siteQ.data ?? EMPTY_PUBLIC_SITE;
  const geo = useHomeGeo(site.district?.number, !siteQ.isPending && site.homepage.offices.show_map);

  // Sekcje z kotwicami powstają dopiero po odpowiedzi API, więc wejście na /#zglos przewijamy ręcznie.
  const contentReady = !siteQ.isPending;
  useEffect(() => {
    if (!contentReady || !window.location.hash) return;
    // Błędny ciąg procentowy (np. /#%) rzuca URIError - wtedy po prostu nie przewijamy.
    let id: string;
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    document.getElementById(id)?.scrollIntoView();
  }, [contentReady]);

  // Do odpowiedzi API szkielet (bez mignięcia domyślnych tekstów); błąd -> treść domyślna.
  if (!contentReady) return <PublicPageSkeleton />;
  return <PublicHome site={site} geo={geo} slots={SLOTS} />;
}

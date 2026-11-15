import { useCallback } from 'react';
import { useSiteContent } from '@/hooks/useSiteContent';
import { mpForms, type MpForms } from '@/lib/mpForms';
import { roleLabel } from '@/lib/permissions';
import type { AppRole } from '@/integrations/supabase/types';

/** Formy tytułu posła instancji (Poseł/Posłanka) z `site_identity.mp_gender`; 'm' do czasu załadowania. */
export function useMpForms(): MpForms {
  return mpForms(useSiteContent().data?.identity.mp_gender ?? 'm');
}

/** Etykiety ról do UI: `posel` zależnie od formy tytułu instancji. */
export function useRoleLabel(): (role: AppRole) => string {
  const forms = useMpForms();
  return useCallback((role: AppRole) => roleLabel(role, forms), [forms]);
}

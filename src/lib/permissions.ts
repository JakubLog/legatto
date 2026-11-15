import type { AppRole } from '@/integrations/supabase/types';
import type { MpForms } from '@/lib/mpForms';

// UWAGA: wartości kluczy MUSZĄ być identyczne z enum `app_role` w DB ('posel', bez 'ł').
// Etykieta roli `posel` zależy od formy tytułu instancji (Poseł/Posłanka) - w komponentach
// używaj `useRoleLabel()` z '@/hooks/useMpForms'.
const OTHER_ROLE_LABELS: Record<Exclude<AppRole, 'posel'>, string> = {
  administrator: 'Administrator',
  pracownik: 'Pracownik',
  asystent: 'Asystent',
};

/** Etykieta roli do UI: `posel` → "Poseł"/"Posłanka" wg `forms`, pozostałe stałe. */
export function roleLabel(role: AppRole, forms: MpForms): string {
  return role === 'posel' ? forms.nominative : OTHER_ROLE_LABELS[role];
}

// Administrator ma te same uprawnienia co Poseł (odpowiednik is_posel() w DB).
export const isAdmin = (role?: AppRole | null): boolean =>
  role === 'posel' || role === 'administrator';

export const canWrite = (role?: AppRole | null): boolean =>
  isAdmin(role) || role === 'pracownik';

export const canRead = (role?: AppRole | null): boolean =>
  canWrite(role) || role === 'asystent';

// Wspolne helpery autoryzacji i audytu dla Edge Functions.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Format UUID (id profili/kontaktow w body) - walidacja przed uzyciem w zapytaniach i audycie. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Czy wywolujacy ma sesje aal2 (zweryfikowane MFA).
 * Funkcje dzialaja na service_role, wiec RLS (is_aal2() w politykach) ich nie chroni -
 * po sprawdzeniu roli trzeba jawnie wymagac aal2. Blad RPC = brak dostepu (fail-closed).
 */
export async function isCallerAal2(callerClient: SupabaseClient): Promise<boolean> {
  const { data, error } = await callerClient.rpc('is_aal2');
  if (error) {
    console.error('is_aal2 rpc error', error);
    return false;
  }
  return data === true;
}

/** Komunikat odmowy, gdy Administrator probuje zmienic konto Posla. */
export const POSEL_ONLY_MESSAGE =
  'Konto Posła może tworzyć, usuwać, blokować i resetować tylko inny Poseł (nie Administrator).';

/**
 * Czy wywolujacy ma role 'posel' (nie 'administrator'). is_posel() obejmuje obie role,
 * a konto Posla (tworzenie z rola 'posel', usuniecie, reset 2FA, wylogowanie, link)
 * zmienia tylko Posel - to samo wymusza trigger profiles_guard_role_active dla zapisow
 * z JWT uzytkownika. Odczyt przez service_role; blad = brak dostepu (fail-closed).
 */
export async function isCallerPoselRole(adminClient: SupabaseClient, callerId: string): Promise<boolean> {
  const { data, error } = await adminClient
    .from('profiles')
    .select('role, is_active')
    .eq('id', callerId)
    .maybeSingle();
  if (error) {
    console.error('caller role lookup error', error);
    return false;
  }
  return data?.role === 'posel' && data.is_active === true;
}

/**
 * Wpis do audit_log w imieniu uzytkownika przez service_role (public.service_log_audit).
 * log_audit nie jest juz wykonywalne przez authenticated. Zwraca false przy bledzie
 * (logowanym); wywolujacy decyduje, czy brak audytu przerywa operacje.
 */
export async function serviceAudit(
  adminClient: SupabaseClient,
  userId: string,
  action: string,
  entityType: string | null,
  entityId: string | null,
  metadata: Record<string, unknown> | null,
): Promise<boolean> {
  const { error } = await adminClient.rpc('service_log_audit', {
    p_user_id: userId,
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_metadata: metadata,
  });
  if (error) {
    console.error('service_log_audit error', action, error);
    return false;
  }
  return true;
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Factor } from '@supabase/supabase-js';
import { parseSiteContent, type SiteContent } from '@/lib/siteContent';
import { SITE_CONTENT_QUERY_KEY } from '@/hooks/useSiteContent';
import { functionErrorMessage } from '@/lib/errors';

// MFA (TOTP) hooki + audit log.
// Wymuszenie 2FA w aplikacji to "wszyscy musza miec" — egzekwowane w ProtectedRoute,
// hooki wystawiaja tylko API.
//
// Konwencja friendlyName: "Biuro Poselskie - {imię i nazwisko posła}" (z treści instancji w chwili enrollmentu),
// bez nazwiska "Biuro Poselskie - {host}" - zeby user latwo rozpoznal klucz w aplikacji authenticator.
// Nazwa jest tylko etykieta: cleanup ponizej i reszta kodu wybieraja factory po statusie, nie po nazwie.

// Nazwisko posla w chwili enrollmentu: z cache React Query, a gdy treść jeszcze się nie wczytała
// (enroll startuje od razu po mount ekranu) - bezpośrednio z RPC. Błąd odczytu = nazwa z hosta.
async function currentMpName(cached: SiteContent | undefined): Promise<string> {
  if (cached) return cached.identity.mp_name;
  try {
    const { data, error } = await supabase.rpc('get_public_site_content');
    if (error) return '';
    return parseSiteContent(data).identity.mp_name;
  } catch {
    return '';
  }
}

export interface MfaFactorsState {
  all: Factor[];
  totp: Factor[];
  verifiedTotp: Factor | null;
}

export function useMfaFactors(userId: string | null | undefined) {
  return useQuery<MfaFactorsState>({
    queryKey: ['mfa-factors', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const totp = (data?.totp ?? []) as Factor[];
      const verifiedTotp = totp.find((f) => f.status === 'verified') ?? null;
      return {
        all: (data?.all ?? []) as Factor[],
        totp,
        verifiedTotp,
      };
    },
    staleTime: 30_000,
  });
}

export interface EnrollResult {
  factorId: string;
  qrCode: string; // SVG data URL z Supabase
  secret: string;
  uri: string;
}

async function tryEnroll(friendlyName: string): Promise<EnrollResult> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  });
  if (error) throw error;
  if (!data) throw new Error('Brak danych enrollment');
  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

export function useEnrollTotp() {
  const qc = useQueryClient();
  return useMutation<EnrollResult, Error, void>({
    mutationFn: async () => {
      const mpName = (await currentMpName(qc.getQueryData<SiteContent>(SITE_CONTENT_QUERY_KEY))).trim();
      const friendlyName = `Biuro Poselskie - ${mpName || window.location.host}`;
      // 1. Cleanup unverified factor-ow (np. user zaczal enroll i wylogowal sie
      //    przed verify). Bez tego Supabase odrzuci nowy enroll z tym samym
      //    friendlyName ('A factor with the friendly name X already exists').
      try {
        const list = await supabase.auth.mfa.listFactors();
        if (list.error) {
          console.warn('[useEnrollTotp] listFactors error', list.error);
        } else {
          const unverified = (list.data?.totp ?? []).filter((f) => f.status !== 'verified');
          if (unverified.length > 0) {
            console.info('[useEnrollTotp] cleanup unverified factors:', unverified.length);
          }
          for (const f of unverified) {
            const { error: unenrollErr } = await supabase.auth.mfa.unenroll({
              factorId: f.id,
            });
            if (unenrollErr) {
              console.warn('[useEnrollTotp] cleanup unenroll failed', f.id, unenrollErr);
            }
          }
        }
      } catch (cleanupErr) {
        console.warn('[useEnrollTotp] cleanup phase failed (will continue)', cleanupErr);
      }

      // 2. Probuj enroll z bazowym friendlyName.
      try {
        return await tryEnroll(friendlyName);
      } catch (err) {
        // 3. Fallback: jesli cleanup nie usunal factora (np. SDK nie pozwala na
        //    unenroll w stanie aal1), Supabase i tak odrzuci enroll z konfliktem
        //    nazwy. Wtedy probujemy z unikalnym suffixem timestamp - user zobaczy
        //    nazwe typu "Biuro Poselskie - Jan Kowalski (2026-05-04 18:55)" w aplikacji
        //    authenticator. To brzydkie ale dziala (lepsze niz blokada enrollment).
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (msg.includes('already exists') || msg.includes('mfa_factor_name_conflict')) {
          const stamp = new Date()
            .toISOString()
            .slice(0, 16)
            .replace('T', ' ');
          console.info('[useEnrollTotp] friendly name conflict — retrying with timestamp suffix');
          return await tryEnroll(`${friendlyName} (${stamp})`);
        }
        throw err;
      }
    },
  });
}

// Verify pierwszego kodu po enroll - factor staje sie verified, session podnosi
// AAL na aal2.
export function useChallengeAndVerifyTotp() {
  const qc = useQueryClient();
  return useMutation<void, Error, { factorId: string; code: string; isEnrollment?: boolean }>({
    mutationFn: async ({ factorId, code }) => {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
      if (error) throw error;
    },
    onSuccess: async (_data, vars) => {
      // Refresh listy factorow + cala session (aal sie zmienil)
      await qc.invalidateQueries({ queryKey: ['mfa-factors'] });

      if (vars.isEnrollment) {
        await supabase.rpc('log_client_event', {
          p_action: 'mfa.enroll',
          p_entity_type: 'profile',
          p_entity_id: null,
          p_metadata: { factor_id: vars.factorId },
        });
      }
    },
    onError: async (_err, vars) => {
      // Audit nieudanej proby (best-effort, nie chcemy maskowac oryginalnego bledu).
      // Bez user_id w metadata bo log_client_event sam to wyciagnie z auth.uid().
      try {
        await supabase.rpc('log_client_event', {
          p_action: 'mfa.verify_failed',
          p_entity_type: 'profile',
          p_entity_id: null,
          p_metadata: { factor_id: vars.factorId },
        });
      } catch {
        // ignore
      }
    },
  });
}

// Self-unenroll (z Profil.tsx). Po sukcesie ProtectedRoute pokaze enrollment screen
// (bo wymuszenie aktywne).
export function useUnenrollTotp() {
  const qc = useQueryClient();
  return useMutation<void, Error, { factorId: string }>({
    mutationFn: async ({ factorId }) => {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
    },
    onSuccess: async (_data, vars) => {
      await qc.invalidateQueries({ queryKey: ['mfa-factors'] });
      await supabase.rpc('log_client_event', {
        p_action: 'mfa.unenroll',
        p_entity_type: 'profile',
        p_entity_id: null,
        p_metadata: { factor_id: vars.factorId },
      });
    },
  });
}

// Admin reset (z admin/Users.tsx) - Posel resetuje cudze MFA przez Edge Function.
// Edge Function wstawia audit_log (mfa.admin_reset), unieważnia hasło (losowe, password_set=false),
// odwołuje tokeny MCP / klientów OAuth i wysyła mail z linkiem (tylko aktywne konto).
export function useResetUserMfa() {
  const qc = useQueryClient();
  return useMutation<{ deleted_count: number; recovery_sent: boolean }, Error, string>({
    mutationFn: async (userId) => {
      const { data, error } = await supabase.functions.invoke<{
        success: boolean;
        deleted_count: number;
        recovery_sent?: boolean;
      }>('admin-reset-user-mfa', {
        body: { user_id: userId },
      });
      if (error) throw new Error(await functionErrorMessage(error));
      if (!data?.success) throw new Error('Nie udało się zresetować 2FA');
      return { deleted_count: data.deleted_count, recovery_sent: data.recovery_sent === true };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['mfa-factors'] });
    },
  });
}

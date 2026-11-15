// Edge Function: admin-reset-user-mfa
// Resetuje (usuwa) wszystkie MFA factor-y wskazanego usera ("zgubiony telefon").
// Dostep tylko dla zalogowanego Posla z sesja aal2 (MFA). Posel NIE moze zresetowac samego siebie tym
// kanalem (recovery wlasnego konta -> drugi Posel albo Supabase Dashboard). 2FA konta Posla
// resetuje tylko inny Posel (nie Administrator).
//
// Body: { user_id: string }
// Response 200: { success: true, deleted_count: number, password_scrambled: true, recovery_sent: boolean }
// Response 500 (czesciowe wykonanie albo brak wpisu audytu): { error, partial: true,
//               failed_step, audit_logged, ...stan krokow } - komunikat mowi, co juz dziala.
//
// Skutki (kolejnosc i uzasadnienie: _shared/credentials.ts lockOutAccount):
// - public.revoke_user_access(user_id, 'admin_mfa_reset', false) (service_role) ->
//   sesje + refresh tokeny + tokeny MCP + aplikacje OAuth usera uniewaznione
// - haslo -> losowe (auth.admin.updateUserById), profiles.password_set = false - samo
//   haslo nie moze wystarczyc do wpiecia nowego 2FA (skradzione haslo = przejecie konta)
// - revoke_user_access ponownie (sesje zalogowane starym haslem w miedzyczasie)
// - kazdy factor z auth.mfa_factors usera (lista pobrana po drugim revoke) zostaje
//   usuniety przez admin API
// - mail z linkiem odzyskania (resetPasswordForEmail) - tylko dla aktywnego konta;
//   po wejsciu z linku user ustawia nowe haslo (PasswordSetupScreen) i nowe 2FA
//   (MfaEnrollmentScreen). Link trafia do usera, nigdy do wywolujacego.
// - audit log: 'mfa.admin_reset' (albo 'mfa.admin_reset_partial' przy bledzie po drodze)
//   z metadanymi (factor_count, target_email, stan kazdego kroku, failed_step)

import { createClient } from '@supabase/supabase-js';
import { corsHeadersFor } from '../_shared/cors.ts';
import { isCallerAal2, isCallerPoselRole, POSEL_ONLY_MESSAGE, serviceAudit, UUID_RE } from '../_shared/auth.ts';
import { lockOutAccount, lockoutFailureMessage } from '../_shared/credentials.ts';

interface RequestBody {
  user_id?: unknown;
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Brak autoryzacji' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: 'Brak konfiguracji środowiska' }, 500);
    }
    // Adres strony logowania tej instancji (link odzyskania w mailu) - bez domyślnej domeny.
    const redirectTo = Deno.env.get('AUTH_REDIRECT_URL')?.trim();
    if (!redirectTo) {
      console.error('Missing AUTH_REDIRECT_URL');
      return json(
        { error: 'Brak konfiguracji: ustaw sekret AUTH_REDIRECT_URL (adres strony logowania, np. https://biuro.example.pl/login)' },
        500,
      );
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: callerUser, error: userError } = await callerClient.auth.getUser();
    if (userError || !callerUser?.user) {
      return json({ error: 'Nie udało się zweryfikować sesji' }, 401);
    }

    const { data: isPoselData, error: roleError } = await callerClient.rpc('is_posel');
    if (roleError) {
      console.error('is_posel rpc error', roleError);
      return json({ error: 'Nie udało się zweryfikować uprawnien' }, 500);
    }
    if (isPoselData !== true) {
      return json({ error: 'Brak uprawnien (wymagana rola: poseł)' }, 403);
    }
    if (!(await isCallerAal2(callerClient))) {
      return json({ error: 'Wymagane uwierzytelnienie dwuskładnikowe (2FA)' }, 403);
    }

    const body = (await req.json().catch(() => null)) as RequestBody | null;
    if (!body || typeof body.user_id !== 'string' || !UUID_RE.test(body.user_id)) {
      return json({ error: 'Niepełne dane (wymagane: user_id)' }, 400);
    }
    const userId = body.user_id;

    if (userId === callerUser.user.id) {
      return json(
        { error: 'Nie możesz zresetować własnego 2FA tym kanałem. Skontaktuj się z innym administratorem biura lub deweloperem.' },
        400,
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Pobierz email do audit log (dla zachowania historii nawet po reset)
    const { data: target, error: targetError } = await adminClient
      .from('profiles')
      .select('email, full_name, role, is_active')
      .eq('id', userId)
      .maybeSingle();
    if (targetError) {
      console.error('profile lookup error', targetError);
      return json({ error: 'Nie udało się pobrać profilu' }, 500);
    }
    if (target?.role === 'posel' && !(await isCallerPoselRole(adminClient, callerUser.user.id))) {
      return json({ error: POSEL_ONLY_MESSAGE }, 403);
    }

    const { data: authData, error: authLookupError } = await adminClient.auth.admin.getUserById(userId);
    if (authLookupError || !authData?.user) {
      console.error('getUserById error', authLookupError);
      return json({ error: 'Nie znaleziono użytkownika' }, 404);
    }
    const authEmail = authData.user.email ?? null;

    const { failedStep, state } = await lockOutAccount(
      adminClient,
      userId,
      'admin_mfa_reset',
      // Konto nieaktywne - bez maila, i tak nie wejdzie. Link na email konta auth.
      target?.is_active === true && authEmail
        ? { supabaseUrl, anonKey, email: authEmail, redirectTo }
        : null,
    );

    const auditLogged = await serviceAudit(
      adminClient,
      callerUser.user.id,
      failedStep ? 'mfa.admin_reset_partial' : 'mfa.admin_reset',
      'profile',
      userId,
      {
        target_email: target?.email ?? authEmail,
        target_full_name: target?.full_name ?? null,
        failed_step: failedStep,
        deleted_count: state.mfa_deleted_count,
        ...state,
      },
    );

    const result = {
      deleted_count: state.mfa_deleted_count,
      password_scrambled: state.password_scrambled,
      recovery_sent: state.recovery_sent,
    };
    if (failedStep || !auditLogged) {
      return json(
        {
          error: lockoutFailureMessage(failedStep, state, auditLogged),
          partial: true,
          failed_step: failedStep,
          audit_logged: auditLogged,
          ...result,
        },
        500,
      );
    }

    return json({ success: true, ...result }, 200);
  } catch (err) {
    console.error('admin-reset-user-mfa error', err);
    return json({ error: 'Wystąpił nieoczekiwany błąd. Skontaktuj się z administratorem.' }, 500);
  }
});

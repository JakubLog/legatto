// Edge Function: admin-revoke-user-sessions
// Wymusza wylogowanie usera ze wszystkich urzadzen + reset MFA factors w jednej akcji.
// Przeznaczone do scenariuszy "kompromitacja konta", "zwolnienie pracownika",
// "zgubiony laptop". Wszystkie sesje + refresh tokeny + MFA factory + tokeny MCP
// i aplikacje OAuth zostaja uniewaznione, a haslo zastapione losowym. Wlasciciel
// konta wraca przez link odzyskania wyslany na jego email (nowe haslo + nowe 2FA).
// Samo stare haslo nie wystarcza juz do wpiecia nowego 2FA.
//
// Dostep tylko dla zalogowanego Posla z sesja aal2 (MFA). Posel NIE moze zrobic tego sobie.
// Konto Posla blokuje tylko inny Posel (nie Administrator).
//
// Body: { user_id: string }
// Response 200: { success: true, sessions_revoked_count: number, mfa_deleted_count: number,
//                 password_scrambled: true, recovery_sent: boolean }
// Response 500 (czesciowe wykonanie albo brak wpisu audytu): { error, partial: true,
//                 failed_step, audit_logged, ...stan krokow } - komunikat mowi, co juz dziala.
//
// Skutki (kolejnosc i uzasadnienie: _shared/credentials.ts lockOutAccount):
// - public.revoke_user_access(user_id, 'admin_revoke_user_sessions', false) (service_role)
//   -> sesje + refresh tokeny + tokeny MCP + aplikacje OAuth; auth.admin.signOut wymaga JWT
//   usera, nie UUID, wiec nie nadaje sie do wylogowania innego uzytkownika
// - haslo -> losowe (auth.admin.updateUserById), profiles.password_set = false
// - revoke_user_access ponownie (sesje zalogowane starym haslem w miedzyczasie)
// - auth.admin.mfa.deleteFactor(...) na wszystkich factor-ach
// - mail z linkiem odzyskania (resetPasswordForEmail) - tylko dla aktywnego konta;
//   link trafia do usera, nigdy do wywolujacego
// - audit log: 'user.sessions_revoked' (albo 'user.sessions_revoke_partial' przy bledzie
//   po drodze) z metadanymi (target_email, stan kazdego kroku, failed_step)

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
        {
          error:
            'Nie możesz wylogować samego siebie tym kanałem. Wyloguj się standardowo z menu profilu.',
        },
        400,
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Pobierz email/nazwe do audit log (przed jakimikolwiek zmianami).
    const { data: target, error: targetError } = await adminClient
      .from('profiles')
      .select('email, full_name, role, is_active')
      .eq('id', userId)
      .maybeSingle();
    if (targetError) {
      console.error('profile lookup error', targetError);
      return json({ error: 'Nie udało się pobrać profilu' }, 500);
    }
    // Konto Posla blokuje tylko inny Posel (nie Administrator).
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
      'admin_revoke_user_sessions',
      // Konto nieaktywne - bez maila, i tak nie wejdzie. Link na email konta auth.
      target?.is_active === true && authEmail
        ? { supabaseUrl, anonKey, email: authEmail, redirectTo }
        : null,
    );

    const auditLogged = await serviceAudit(
      adminClient,
      callerUser.user.id,
      failedStep ? 'user.sessions_revoke_partial' : 'user.sessions_revoked',
      'profile',
      userId,
      {
        target_email: target?.email ?? authEmail,
        target_full_name: target?.full_name ?? null,
        failed_step: failedStep,
        ...state,
      },
    );

    const result = {
      sessions_revoked_count: state.sessions_revoked_count,
      mfa_deleted_count: state.mfa_deleted_count,
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
    console.error('admin-revoke-user-sessions error', err);
    return json({ error: 'Wystąpił nieoczekiwany błąd. Skontaktuj się z administratorem.' }, 500);
  }
});

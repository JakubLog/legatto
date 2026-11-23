// Edge Function: admin-send-auth-link
// Wysyła link autoryzacyjny do wskazanego usera. Tryb wybierany dynamicznie:
//  - profile.password_set = false  -> 'invite' (re-send zaproszenia)
//  - profile.password_set = true   -> 'recovery' (link resetu hasła)
//
// Cooldown: 5 min per user. Wpis audytu ('user.invite_resent' / 'user.password_reset_sent')
// powstaje PRZED wysylka atomowo przez RPC service_audit_claim_cooldown (advisory lock per
// user), wiec rownolegle wywolania nie omijaja limitu. Nieudana wysylka dopisuje
// 'user.auth_link_failed' (cooldown zostaje - chroni tez przed zalewaniem bledami).
// Link idzie na email konta Auth (auth.admin.getUserById), nie na edytowalny profiles.email.
// Blokada self-link — Posel ma user-side flow przez ekran logowania.
// Dostep tylko dla zalogowanego Posla z sesja aal2 (MFA); do konta Posla link wysyla tylko
// inny Posel (nie Administrator).
//
// Wysylka maila: admin.generateLink tylko generuje link (nie wysyla maila), wiec:
//  - invite   -> admin.inviteUserByEmail (GoTrue ponownie wysyla zaproszenie dla
//                niepotwierdzonego konta); gdy konto jest juz potwierdzone (kliknal
//                zaproszenie, ale nie ustawil hasla) -> signInWithOtp (magic link,
//                shouldCreateUser=false; PasswordSetupScreen wymusi haslo, bo password_set=false)
//  - recovery -> resetPasswordForEmail (mail z linkiem resetu hasla)
//
// Body: { user_id: string }
// Response: { success: true, kind: 'invite' | 'recovery' }
// Audit:
//   - 'user.invite_resent' (kind='invite')
//   - 'user.password_reset_sent' (kind='recovery')
//   - 'user.auth_link_failed' (wysylka nie powiodla sie po zapisaniu wpisu)

import { createClient } from '@supabase/supabase-js';
import { corsHeadersFor } from '../_shared/cors.ts';
import { adminSurfaceGuard } from '../_shared/surface.ts';
import { isCallerAal2, isCallerPoselRole, POSEL_ONLY_MESSAGE, serviceAudit, UUID_RE } from '../_shared/auth.ts';
import { errorSummary } from '../_shared/log-safe.ts';

const COOLDOWN_SECONDS = 5 * 60;
const COOLDOWN_ACTIONS = ['user.invite_resent', 'user.password_reset_sent'];

interface RequestBody {
  user_id?: unknown;
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }
  // Na VPS tylko z hosta admin (A5); na crm 404 jak blokada proxy.
  const surfaceDenied = adminSurfaceGuard(req, cors);
  if (surfaceDenied) return surfaceDenied;

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
    // Adres strony logowania tej instancji (link w mailu) - bez domyślnej domeny.
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
      console.error('is_posel rpc error', errorSummary(roleError));
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
        { error: 'Nie możesz wysłać linku sobie. Skorzystaj z formularza logowania.' },
        400,
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: target, error: targetError } = await adminClient
      .from('profiles')
      .select('full_name, role, password_set, is_active')
      .eq('id', userId)
      .maybeSingle();
    if (targetError) {
      console.error('profile lookup error', errorSummary(targetError));
      return json({ error: 'Nie udało się pobrać profilu' }, 500);
    }
    if (!target) {
      return json({ error: 'Nie znaleziono użytkownika' }, 404);
    }
    if (!target.is_active) {
      return json(
        { error: 'Konto jest nieaktywne. Aktywuj konto przed wysłaniem linku.' },
        400,
      );
    }
    if (target.role === 'posel' && !(await isCallerPoselRole(adminClient, callerUser.user.id))) {
      return json({ error: POSEL_ONLY_MESSAGE }, 403);
    }

    // Adres konta Auth (profiles.email jest edytowalny i moze sie rozjechac z kontem logowania).
    const { data: authData, error: authLookupError } = await adminClient.auth.admin.getUserById(userId);
    if (authLookupError || !authData?.user) {
      console.error('getUserById error', errorSummary(authLookupError));
      return json({ error: 'Nie znaleziono konta logowania użytkownika' }, 404);
    }
    const authEmail = authData.user.email;
    if (!authEmail) {
      return json({ error: 'Konto logowania nie ma adresu email' }, 400);
    }

    const kind: 'invite' | 'recovery' = target.password_set ? 'recovery' : 'invite';
    const action = kind === 'invite' ? 'user.invite_resent' : 'user.password_reset_sent';
    const auditMetadata = { target_email: authEmail, target_full_name: target.full_name };

    // Cooldown + wpis audytu atomowo, przed wysylka.
    const { data: retryAfter, error: claimError } = await adminClient.rpc('service_audit_claim_cooldown', {
      p_user_id: callerUser.user.id,
      p_action: action,
      p_entity_type: 'profile',
      p_entity_id: userId,
      p_metadata: auditMetadata,
      p_cooldown_actions: COOLDOWN_ACTIONS,
      p_cooldown_seconds: COOLDOWN_SECONDS,
    });
    if (claimError || typeof retryAfter !== 'number') {
      console.error('cooldown claim error', errorSummary(claimError));
      return json({ error: 'Nie udało się sprawdzić limitu wysyłki' }, 500);
    }
    if (retryAfter > 0) {
      return json(
        {
          error: `Limit czasowy: spróbuj ponownie za ${retryAfter}s`,
          retry_after_seconds: retryAfter,
        },
        429,
      );
    }

    // Bledy GoTrue (AuthError) dziedzicza po Error.
    const sendFailed = async (message: string, detail: Error) => {
      await serviceAudit(adminClient, callerUser.user.id, 'user.auth_link_failed', 'profile', userId, {
        ...auditMetadata,
        kind,
        error: detail.message,
      });
      return json({ error: message }, 400);
    };

    // Klient publiczny (anon) do endpointow wysylajacych maile (/recover, /otp).
    // flowType implicit: link z tokenem w hash, bez PKCE code_verifier po stronie serwera.
    const publicClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, flowType: 'implicit' },
    });

    if (kind === 'invite') {
      const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(authEmail, {
        data: { full_name: target.full_name },
        redirectTo,
      });
      if (inviteError) {
        // Konto juz potwierdzone (GoTrue odrzuca invite) -> magic link bez tworzenia usera.
        console.error('inviteUserByEmail resend error', errorSummary(inviteError));
        const { error: magicError } = await publicClient.auth.signInWithOtp({
          email: authEmail,
          options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
        });
        if (magicError) {
          console.error('signInWithOtp error', errorSummary(magicError));
          return await sendFailed('Nie udało się wysłać zaproszenia', magicError);
        }
      }
    } else {
      const { error: recoveryError } = await publicClient.auth.resetPasswordForEmail(authEmail, {
        redirectTo,
      });
      if (recoveryError) {
        console.error('resetPasswordForEmail error', errorSummary(recoveryError));
        return await sendFailed('Nie udało się wysłać linku resetu hasła', recoveryError);
      }
    }

    return json({ success: true, kind }, 200);
  } catch (err) {
    console.error('admin-send-auth-link error', errorSummary(err));
    return json({ error: 'Wystąpił nieoczekiwany błąd. Skontaktuj się z administratorem.' }, 500);
  }
});

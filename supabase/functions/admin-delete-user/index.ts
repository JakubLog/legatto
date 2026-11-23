// Edge Function: admin-delete-user
// Calkowicie usuwa konto uzytkownika (auth.users + cascade na profiles).
// Dostep tylko dla zalogowanego Posla z sesja aal2 (MFA). Posel nie moze usunac samego siebie.
// Konto Posla usuwa tylko inny Posel (nie Administrator).
//
// Body: { user_id: string }
//
// Skutki:
// - DELETE auth.users(user_id) -> CASCADE -> profiles (FK on delete cascade)
// - audit_log.user_id, contacts.created_by, cases.created_by/assigned_to,
//   events.created_by/assigned_to, interpellations.created_by,
//   visibility.updated_by, public_submissions.triaged_by -> SET NULL
//   (historia zachowana, autor staje sie NULL)
// - Avatar w Storage `avatars/{user_id}/...` pozostaje jako orphan (akceptowalne w MVP)

import { createClient } from '@supabase/supabase-js';
import { corsHeadersFor } from '../_shared/cors.ts';
import { adminSurfaceGuard } from '../_shared/surface.ts';
import { isCallerAal2, isCallerPoselRole, POSEL_ONLY_MESSAGE, serviceAudit, UUID_RE } from '../_shared/auth.ts';
import { errorSummary } from '../_shared/log-safe.ts';

interface RequestBody {
  user_id?: unknown;
}

// Komunikat triggera profiles (errcode 23514) - ostatni aktywny Poseł musi zostać.
const LAST_POSEL_MESSAGE = 'Nie można usunąć ani zdezaktywować ostatniego aktywnego Posła';

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

    // Klient z tokenem usera — sprawdzenie roli wywolujacego (RLS aware).
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
      return json({ error: 'Nie możesz usunąć własnego konta' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Pobierz dane profilu do audit log (przed usunieciem).
    const { data: target, error: targetError } = await adminClient
      .from('profiles')
      .select('email, full_name, role, office_id, is_active')
      .eq('id', userId)
      .maybeSingle();
    if (targetError) {
      console.error('profile lookup error', errorSummary(targetError));
      return json({ error: 'Nie udało się pobrać profilu' }, 500);
    }

    if (target?.role === 'posel' && !(await isCallerPoselRole(adminClient, callerUser.user.id))) {
      return json({ error: POSEL_ONLY_MESSAGE }, 403);
    }

    // Ostatni aktywny Poseł: trigger na profiles (BEFORE DELETE, kaskada z auth.users)
    // odrzuci usuniecie, ale GoTrue zwraca wtedy ogolny blad 500 bez komunikatu z bazy.
    // Sprawdzamy to wczesniej ta sama regula co trigger (liczy sie tylko konto z haslem
    // i zweryfikowanym 2FA), zeby zwrocic czytelny 409. Trigger zostaje zabezpieczeniem
    // na wypadek wyscigu.
    if (target?.role === 'posel' && target.is_active) {
      const { data: otherRealPosel, error: countError } = await adminClient.rpc(
        'service_other_real_posel_exists',
        { p_exclude: userId },
      );
      if (countError) {
        console.error('last posel check error', errorSummary(countError));
        return json({ error: 'Nie udało się zweryfikować kont Posłów' }, 500);
      }
      if (otherRealPosel !== true) {
        return json({ error: LAST_POSEL_MESSAGE }, 409);
      }
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error('deleteUser error', errorSummary(deleteError));
      // Wyscig z pre-checkiem: GoTrue przekazuje sqlstate triggera w polu code.
      if ('code' in deleteError && deleteError.code === '23514') {
        return json({ error: LAST_POSEL_MESSAGE }, 409);
      }
      return json({ error: 'Nie udało się usunąć użytkownika' }, 400);
    }

    await serviceAudit(adminClient, callerUser.user.id, 'user.delete', 'profile', userId, target ?? {
      user_id: userId,
    });

    return json({ success: true }, 200);
  } catch (err) {
    console.error('admin-delete-user error', errorSummary(err));
    return json({ error: 'Wystąpił nieoczekiwany błąd. Skontaktuj się z administratorem.' }, 500);
  }
});

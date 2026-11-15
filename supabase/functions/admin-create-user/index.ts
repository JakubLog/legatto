// Edge Function: admin-create-user
// Tworzy nowe konto użytkownika i przypisuje role + biuro.
// Dostęp tylko dla zalogowanego Posła lub Administratora z sesją aal2 (MFA): getUser()
// + public.is_posel() + public.is_aal2().
//
// Body: {
//   email: string, full_name: string,
//   role: 'posel' | 'administrator' | 'pracownik' | 'asystent',
//   office_id?: string | null   // wymagane dla pracownik/asystent
//   scope_contacts?, scope_cases?, scope_events?, scope_interpellations?: 'own' | 'all'
//     // zakres danych per moduł (domyślnie 'all'); ignorowany dla posel/administrator
// }
// Tworzy konto przez auth.admin.createUser (blad, gdy adres juz istnieje - nigdy nie
// przejmujemy cudzego konta), potem wysyła zaproszenie email z linkiem do ustawienia hasła.
// Rolę 'posel' może nadać tylko Poseł (nie Administrator).

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { corsHeadersFor } from '../_shared/cors.ts';
import { isCallerAal2, isCallerPoselRole, POSEL_ONLY_MESSAGE, serviceAudit, UUID_RE } from '../_shared/auth.ts';

type Role = 'posel' | 'administrator' | 'pracownik' | 'asystent';

interface RequestBody {
  email?: unknown;
  full_name?: unknown;
  role?: unknown;
  office_id?: unknown;
  scope_contacts?: unknown;
  scope_cases?: unknown;
  scope_events?: unknown;
  scope_interpellations?: unknown;
}

type DataScope = 'own' | 'all';
const SCOPE_FIELDS = ['scope_contacts', 'scope_cases', 'scope_events', 'scope_interpellations'] as const;
type ScopeField = (typeof SCOPE_FIELDS)[number];

const ROLES: readonly Role[] = ['posel', 'administrator', 'pracownik', 'asystent'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Szuka konta auth po emailu (bez rozroznienia wielkosci liter). GoTrue admin API nie
 * ma filtra po emailu w supabase-js, wiec przegladamy liste - kont biura jest kilkadziesiat.
 */
async function findAuthUserByEmail(
  adminClient: SupabaseClient,
  email: string,
): Promise<{ user: User | null; error: unknown }> {
  const needle = email.toLowerCase();
  const perPage = 1000;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) return { user: null, error };
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === needle);
    if (found) return { user: found, error: null };
    if (users.length < perPage) return { user: null, error: null };
  }
  return { user: null, error: new Error('listUsers: przekroczono limit stron') };
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
    // Adres strony logowania tej instancji (link w mailu z zaproszeniem) - bez domyślnej domeny.
    const redirectTo = Deno.env.get('AUTH_REDIRECT_URL')?.trim();
    if (!redirectTo) {
      console.error('Missing AUTH_REDIRECT_URL');
      return json(
        { error: 'Brak konfiguracji: ustaw sekret AUTH_REDIRECT_URL (adres strony logowania, np. https://biuro.example.pl/login)' },
        500,
      );
    }

    // Klient z tokenem usera - używamy do sprawdzenia roli wywołującego (RLS aware).
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    // Weryfikacja sesji w GoTrue (odrzuca tokeny wylogowanych sesji przed ich exp).
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
    if (
      !body ||
      typeof body.email !== 'string' ||
      typeof body.full_name !== 'string' ||
      typeof body.role !== 'string' ||
      !body.email.trim() ||
      !body.full_name.trim()
    ) {
      return json({ error: 'Niepełne dane (wymagane: email, full_name, role)' }, 400);
    }

    const email = body.email.trim().toLowerCase();
    const fullName = body.full_name.trim();
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return json({ error: 'Nieprawidłowy adres email' }, 400);
    }
    if (fullName.length > 200) {
      return json({ error: 'Imię i nazwisko za długie (max 200 znaków)' }, 400);
    }

    if (!ROLES.includes(body.role as Role)) {
      return json({ error: 'Nieprawidłowa rola' }, 400);
    }
    const role = body.role as Role;

    // Walidacja office_id: Pracownik i Asystent muszą być przypisani do biura.
    if (body.office_id != null && (typeof body.office_id !== 'string' || !UUID_RE.test(body.office_id))) {
      return json({ error: 'Nieprawidłowe biuro' }, 400);
    }
    const officeId = (body.office_id as string | null | undefined) ?? null;
    if ((role === 'pracownik' || role === 'asystent') && !officeId) {
      return json({ error: 'Pracownik i Asystent muszą być przypisani do biura' }, 400);
    }

    // Zakresy danych (own/all). Poseł i Administrator zawsze widzą wszystko, więc dla nich
    // zostaje default kolumn ('all'), a przesłane wartości są pomijane.
    const scopes: Partial<Record<ScopeField, DataScope>> = {};
    for (const field of SCOPE_FIELDS) {
      const value = body[field];
      if (value == null) continue;
      if (value !== 'own' && value !== 'all') {
        return json({ error: 'Nieprawidłowy zakres danych (dozwolone: own, all)' }, 400);
      }
      if (role === 'pracownik' || role === 'asystent') scopes[field] = value;
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Konto Posla (wlasciciela instancji) zaklada tylko Posel.
    if (role === 'posel' && !(await isCallerPoselRole(adminClient, callerUser.user.id))) {
      return json({ error: POSEL_ONLY_MESSAGE }, 403);
    }

    // Sprawdź czy biuro istnieje i jest aktywne (dla rol != poseł; dla Posła, gdy podane)
    if (officeId) {
      const { data: office, error: officeError } = await adminClient
        .from('offices')
        .select('id, is_active')
        .eq('id', officeId)
        .maybeSingle();
      if (officeError) {
        console.error('office lookup error', officeError);
        return json({ error: 'Nie udało się zweryfikować biura' }, 500);
      }
      if (!office) {
        return json({ error: 'Wybrane biuro nie istnieje' }, 400);
      }
      if (!office.is_active) {
        return json({ error: 'Wybrane biuro jest nieaktywne' }, 400);
      }
    }

    // Istniejący profil z tym emailem = konto już jest w systemie. Bez tej kontroli
    // invite dla oczekującego zaproszenia zwróciłby istniejącego usera, a rollback
    // po konflikcie profilu usunąłby jego konto.
    const { data: existingProfile, error: existingError } = await adminClient
      .from('profiles')
      .select('id')
      // ILIKE = porównanie bez rozróżniania wielkości liter; escapujemy znaki wzorca.
      .ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`))
      .limit(1)
      .maybeSingle();
    if (existingError) {
      console.error('profile lookup error', existingError);
      return json({ error: 'Nie udało się zweryfikować adresu email' }, 500);
    }
    if (existingProfile) {
      return json({ error: 'Użytkownik z tym adresem email już istnieje' }, 409);
    }

    // Konto auth z tym emailem bez profilu (np. z dawnej otwartej rejestracji) moglo
    // dostac haslo od kogos innego niz wlasciciel adresu - nadanie mu roli = przejecie
    // konta. Niepotwierdzonego i nigdy nie zalogowanego sieroty usuwamy i zakladamy konto
    // od nowa; potwierdzone konto bez profilu odrzucamy (decyzja wlasciciela w Dashboard).
    const { user: orphan, error: orphanLookupError } = await findAuthUserByEmail(adminClient, email);
    if (orphanLookupError) {
      console.error('auth user lookup error', orphanLookupError);
      return json({ error: 'Nie udało się zweryfikować adresu email' }, 500);
    }
    if (orphan) {
      const { data: orphanProfile, error: orphanProfileError } = await adminClient
        .from('profiles')
        .select('id')
        .eq('id', orphan.id)
        .maybeSingle();
      if (orphanProfileError) {
        console.error('orphan profile lookup error', orphanProfileError);
        return json({ error: 'Nie udało się zweryfikować adresu email' }, 500);
      }
      if (orphanProfile) {
        return json({ error: 'Użytkownik z tym adresem email już istnieje' }, 409);
      }
      const neverUsed = !orphan.email_confirmed_at && !orphan.confirmed_at && !orphan.last_sign_in_at;
      if (!neverUsed) {
        return json(
          {
            error:
              'Dla tego adresu email istnieje już konto logowania bez profilu w biurze. Ze względów bezpieczeństwa nie zostanie użyte – usuń je w panelu Supabase (Authentication → Users) i spróbuj ponownie.',
          },
          409,
        );
      }
      const { error: orphanDeleteError } = await adminClient.auth.admin.deleteUser(orphan.id);
      if (orphanDeleteError) {
        console.error('orphan deleteUser error', orphanDeleteError);
        return json({ error: 'Nie udało się usunąć starego, niepotwierdzonego konta z tym adresem email' }, 500);
      }
      await serviceAudit(adminClient, callerUser.user.id, 'user.orphan_auth_deleted', 'profile', orphan.id, {
        email: orphan.email ?? email,
        orphan_created_at: orphan.created_at,
      });
    }

    // Konto tworzymy sami: createUser odrzuca istniejacy adres (422 email_exists), wiec
    // konto zalozone przez kogos innego po sprawdzeniu sieroty (z jego haslem) nigdy nie
    // dostanie profilu. Nowe konto nie ma hasla; ustawia je wlasciciel adresu z zaproszenia.
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { full_name: fullName },
    });
    if (createError || !created?.user) {
      console.error('createUser error', createError);
      const alreadyExists =
        createError?.status === 422 || /already|exists/i.test(createError?.message ?? '');
      return json(
        {
          error: alreadyExists
            ? 'Konto z tym adresem email powstało w międzyczasie. Spróbuj ponownie.'
            : 'Nie udało się utworzyć konta użytkownika',
        },
        alreadyExists ? 409 : 400,
      );
    }
    const newUserId = created.user.id;

    // Rollback: konto powstalo w tym wywolaniu i nie ma profilu - usuwamy je.
    const rollbackAuthUser = async () => {
      const { error: rollbackError } = await adminClient.auth.admin.deleteUser(newUserId);
      if (rollbackError) console.error('rollback deleteUser error', rollbackError);
    };

    // Zaproszenie: GoTrue wysyla mail dla istniejacego, niepotwierdzonego konta (naszego).
    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo,
    });
    if (inviteError || invited?.user?.id !== newUserId) {
      console.error('inviteUserByEmail error', inviteError, invited?.user?.id);
      await rollbackAuthUser();
      return json({ error: 'Nie udało się wysłać zaproszenia' }, 400);
    }

    // Utwórz profil
    const { error: profileError } = await adminClient.from('profiles').insert({
      id: newUserId,
      email,
      full_name: fullName,
      role,
      is_active: true,
      office_id: officeId,
      ...scopes,
    });

    if (profileError) {
      console.error('profile insert error', profileError);
      await rollbackAuthUser();
      return profileError.code === '23505'
        ? json({ error: 'Użytkownik z tym adresem email już istnieje' }, 409)
        : json({ error: 'Nie udało się utworzyć profilu użytkownika' }, 500);
    }

    // Audit log (w imieniu wywołującego, przez service_role)
    await serviceAudit(adminClient, callerUser.user.id, 'user.create', 'profile', newUserId, {
      role,
      email,
      office_id: officeId,
      ...scopes,
    });

    return json({ success: true, user_id: newUserId }, 200);
  } catch (err) {
    console.error('admin-create-user error', err);
    return json({ error: 'Wystąpił nieoczekiwany błąd. Skontaktuj się z administratorem.' }, 500);
  }
});

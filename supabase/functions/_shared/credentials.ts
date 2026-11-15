// Uniewaznienie dostepu + hasla + 2FA i link odzyskania konta dla akcji admina
// (admin-revoke-user-sessions, admin-reset-user-mfa).
//
// Po usunieciu factorow 2FA samo haslo nie moze wystarczyc do wpiecia nowego TOTP
// (ktos ze skradzionym haslem zrobilby enrollment przed wlascicielem). Dlatego haslo
// jest zastepowane losowym, a wlasciciel konta wraca przez link z maila:
// recovery -> sesja aal1 -> PasswordSetupScreen (password_set = false) -> nowe 2FA.
//
// Kolejnosc (lockOutAccount) zamyka wyscig z atakujacym, ktory ma zywa sesje i w petli
// zmienia haslo (PUT /auth/v1/user, secure_password_change = false):
// 1. revoke_user_access - atakujacy traci sesje potrzebna do zmiany hasla;
// 2. losowe haslo;
// 3. revoke_user_access ponownie - sesje zalogowane starym haslem miedzy 1 a 2;
// 4. lista + usuniecie factorow 2FA (dopiero po 3 - factor wpiety w oknie tez znika);
// 5. mail z linkiem odzyskania.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Losowe haslo (256 bitow). Prefiks spelnia password_requirements
 * ('lower_upper_letters_digits_symbols'); nikt go nie zna i nie jest nigdzie zwracane.
 */
function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64url = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `Aa1!${b64url}`;
}

export interface ScrambleResult {
  /** Haslo zastapione losowym (stare haslo przestalo dzialac). */
  passwordScrambled: boolean;
  /** profiles.password_set = false - po wejsciu z linku aplikacja wymusi nowe haslo. */
  passwordSetupRequired: boolean;
}

/**
 * Zastepuje haslo usera losowym i ustawia profiles.password_set = false.
 * Blad zmiany hasla = passwordScrambled false (wywolujacy przerywa akcje).
 * Blad flagi nie przerywa akcji (haslo i tak juz nie dziala), jest logowany.
 */
async function scramblePassword(
  adminClient: SupabaseClient,
  userId: string,
): Promise<ScrambleResult> {
  const { error: passwordError } = await adminClient.auth.admin.updateUserById(userId, {
    password: randomPassword(),
  });
  if (passwordError) {
    console.error('scramble password error', passwordError);
    return { passwordScrambled: false, passwordSetupRequired: false };
  }

  const { error: flagError } = await adminClient
    .from('profiles')
    .update({ password_set: false })
    .eq('id', userId);
  if (flagError) console.error('password_set reset error', flagError);

  return { passwordScrambled: true, passwordSetupRequired: !flagError };
}

/**
 * Wysyla mail z linkiem odzyskania konta (GoTrue /recover - mechanizm jak w
 * admin-send-auth-link). Link trafia tylko na adres usera, nigdy do wywolujacego.
 */
async function sendRecoveryEmail(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  redirectTo: string,
): Promise<boolean> {
  // flowType implicit: link z tokenem w hash, bez PKCE code_verifier po stronie serwera.
  const publicClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, flowType: 'implicit' },
  });
  const { error } = await publicClient.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    console.error('resetPasswordForEmail error', error);
    return false;
  }
  return true;
}

type RevokeCounters = Record<string, unknown>;

/** public.revoke_user_access(..., p_ban=false): sesje, refresh tokeny, MCP, OAuth. null = blad. */
async function revokeAccess(
  adminClient: SupabaseClient,
  userId: string,
  reason: string,
): Promise<RevokeCounters | null> {
  const { data, error } = await adminClient.rpc('revoke_user_access', {
    p_user_id: userId,
    p_reason: reason,
    p_ban: false,
  });
  if (error) {
    console.error('revoke_user_access error', reason, error);
    return null;
  }
  return data && typeof data === 'object' ? (data as RevokeCounters) : {};
}

export type LockoutStep = 'revoke_initial' | 'scramble' | 'revoke_final' | 'mfa_list' | 'mfa_delete';

/** Stan po lockOutAccount - do audytu i odpowiedzi (takze czesciowy przy bledzie). */
export interface LockoutState {
  revoke_initial: RevokeCounters | null;
  password_scrambled: boolean;
  password_setup_required: boolean;
  revoke_final: RevokeCounters | null;
  /** Liczba factorow 2FA znalezionych po drugim revoke (null = nie odczytano). */
  factor_count: number | null;
  mfa_deleted_count: number;
  recovery_sent: boolean;
  /** Laczna liczba usunietych sesji (oba revoke). */
  sessions_revoked_count: number;
}

export interface LockoutResult {
  /** Krok, na ktorym akcja sie zatrzymala (null = wszystkie kroki wykonane). */
  failedStep: LockoutStep | null;
  state: LockoutState;
}

export interface RecoveryTarget {
  supabaseUrl: string;
  anonKey: string;
  email: string;
  redirectTo: string;
}

/**
 * Odcina dostep do konta w kolejnosci opisanej w naglowku pliku. Zatrzymuje sie na
 * pierwszym bledzie (bez maila odzyskania, jesli konto nie jest w pelni zablokowane);
 * ponowienie akcji jest bezpieczne. recovery = null: bez maila (konto nieaktywne / brak emaila).
 */
export async function lockOutAccount(
  adminClient: SupabaseClient,
  userId: string,
  reason: string,
  recovery: RecoveryTarget | null,
): Promise<LockoutResult> {
  const state: LockoutState = {
    revoke_initial: null,
    password_scrambled: false,
    password_setup_required: false,
    revoke_final: null,
    factor_count: null,
    mfa_deleted_count: 0,
    recovery_sent: false,
    sessions_revoked_count: 0,
  };
  const addSessions = (counters: RevokeCounters) => {
    const n = Number(counters.sessions);
    if (Number.isFinite(n)) state.sessions_revoked_count += n;
  };

  state.revoke_initial = await revokeAccess(adminClient, userId, reason);
  if (!state.revoke_initial) return { failedStep: 'revoke_initial', state };
  addSessions(state.revoke_initial);

  const scramble = await scramblePassword(adminClient, userId);
  state.password_scrambled = scramble.passwordScrambled;
  state.password_setup_required = scramble.passwordSetupRequired;
  if (!scramble.passwordScrambled) return { failedStep: 'scramble', state };

  state.revoke_final = await revokeAccess(adminClient, userId, reason);
  if (!state.revoke_final) return { failedStep: 'revoke_final', state };
  addSessions(state.revoke_final);

  const { data: factorsData, error: listError } = await adminClient.auth.admin.mfa.listFactors({
    userId,
  });
  if (listError) {
    console.error('listFactors error', listError);
    return { failedStep: 'mfa_list', state };
  }
  const factors = factorsData?.factors ?? [];
  state.factor_count = factors.length;
  for (const factor of factors) {
    const { error: deleteError } = await adminClient.auth.admin.mfa.deleteFactor({
      userId,
      id: factor.id,
    });
    if (deleteError) {
      console.error('deleteFactor error', factor.id, deleteError);
      continue;
    }
    state.mfa_deleted_count++;
  }
  if (state.mfa_deleted_count < factors.length) return { failedStep: 'mfa_delete', state };

  if (recovery) {
    state.recovery_sent = await sendRecoveryEmail(
      recovery.supabaseUrl,
      recovery.anonKey,
      recovery.email,
      recovery.redirectTo,
    );
  }
  return { failedStep: null, state };
}

/** Komunikat dla admina: ktore kroki sie wykonaly, co jeszcze dziala i czy jest wpis audytu. */
export function lockoutFailureMessage(
  failedStep: LockoutStep | null,
  state: LockoutState,
  auditLogged: boolean,
): string {
  let message: string;
  switch (failedStep) {
    case 'revoke_initial':
      message = 'Nie udało się unieważnić sesji użytkownika. Hasło i 2FA nie zostały zmienione. Spróbuj ponownie.';
      break;
    case 'scramble':
      message =
        'Sesje i tokeny zostały unieważnione, ale nie udało się zmienić hasła - stare hasło nadal działa. Spróbuj ponownie.';
      break;
    case 'revoke_final':
      message =
        'Hasło zostało unieważnione, ale nie udało się ponownie unieważnić sesji (mogła powstać nowa sesja). Spróbuj ponownie.';
      break;
    case 'mfa_list':
    case 'mfa_delete':
      message =
        `Hasło, sesje i tokeny zostały unieważnione, ale nie udało się usunąć wszystkich metod 2FA ` +
        `(usunięto ${state.mfa_deleted_count} z ${state.factor_count ?? '?'}). ` +
        'Link odzyskania nie został wysłany. Spróbuj ponownie.';
      break;
    default:
      message = 'Akcja została wykonana w całości.';
  }
  return auditLogged
    ? message
    : `${message} Nie udało się zapisać wpisu w dzienniku audytu - zgłoś to administratorowi.`;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Factor, Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Profile } from '@/integrations/supabase/types';
import { clearRecent } from '@/components/search/recent';
import { clearNewsletterDrafts } from '@/components/campaigns/newsletter/draft';
import { setPrivacyLocked } from '@/lib/privacyLock';
import { removeThisDevicePush } from '@/lib/pushSubscription';

type Aal = 'aal1' | 'aal2' | null;

interface MfaState {
  factors: Factor[];
  verifiedTotp: Factor | null;
  currentLevel: Aal;
  nextLevel: Aal;
  loading: boolean;
}

// loading=false jako default - true ustawiamy tylko podczas aktywnego fetch.
// Bez tego po signOut MFA zostaje w stanie loading -> ProtectedRoute wieczny spinner.
const INITIAL_MFA: MfaState = {
  factors: [],
  verifiedTotp: null,
  currentLevel: null,
  nextLevel: null,
  loading: false,
};

/** Okresowe odświeżenie profilu - dezaktywacja konta widoczna bez przeładowania strony. */
const PROFILE_REFRESH_MS = 5 * 60 * 1000;

/** sessionStorage: id usera, który wszedł linkiem odzyskania hasła (przetrwa przeładowanie karty). */
const RECOVERY_STORAGE_KEY = 'app.passwordRecovery';

function readRecoveryUserId(): string | null {
  try {
    return sessionStorage.getItem(RECOVERY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeRecoveryUserId(userId: string | null): void {
  try {
    if (userId) sessionStorage.setItem(RECOVERY_STORAGE_KEY, userId);
    else sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
  } catch {
    // Brak sessionStorage (tryb prywatny) - flaga zostaje tylko w pamięci.
  }
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  mfa: MfaState;
  /** Sesja z linku odzyskania hasła - ProtectedRoute wymusza ustawienie nowego hasła. */
  passwordRecovery: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  /** `local` - tylko ta karta/urządzenie (gdy sesja na serwerze mogła już zostać unieważniona). */
  signOut: (scope?: 'global' | 'local') => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Po ustawieniu nowego hasła (PasswordSetupScreen) - zdejmuje wymuszenie z linku odzyskania. */
  clearPasswordRecovery: () => void;
  refreshMfa: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfa, setMfa] = useState<MfaState>(INITIAL_MFA);
  const [recoveryUserId, setRecoveryUserId] = useState<string | null>(readRecoveryUserId);
  const queryClient = useQueryClient();

  // Ref śledzi ostatnio załadowany userId. Używamy ref (nie state) żeby callback
  // onAuthStateChange miał zawsze aktualną wartość bez rozszerzania tablicy deps.
  const loadedUserIdRef = useRef<string | null>(null);
  // Ostatni znany user sesji (nie zerowany przy błędzie profilu) - do wykrycia zmiany usera.
  const sessionUserIdRef = useRef<string | null>(null);

  // Dane poprzedniego usera nie mogą przetrwać wylogowania ani zmiany konta w tej samej karcie:
  // cache react-query (klucze bez userId) i "Ostatnie" w wyszukiwarce (nazwiska, tytuły spraw).
  const clearClientData = useCallback(() => {
    queryClient.clear();
    clearRecent();
  }, [queryClient]);

  // keepOnError: odświeżenie w tle nie zeruje profilu przy chwilowym błędzie sieci
  // (null = redirect na /login?reason=no_profile i wylogowanie).
  const fetchProfile = useCallback(async (userId: string, keepOnError = false) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, is_active, office_id, phone, avatar_url, is_public, password_set, has_privacy_pin, scope_contacts, scope_cases, scope_events, scope_interpellations, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('[Auth] Błąd pobierania profilu', error);
      if (!keepOnError) setProfile(null);
      return;
    }
    if (!data) {
      console.warn('[Auth] Brak profilu dla user_id:', userId, '- wymagany seed w public.profiles');
    }
    setProfile((data as Profile | null) ?? null);
    loadedUserIdRef.current = data ? userId : null;
  }, []);

  const fetchMfa = useCallback(async () => {
    const [factorsRes, aalRes] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);

    if (factorsRes.error) {
      console.error('[Auth] Błąd pobierania factor-ow MFA', factorsRes.error);
    }
    if (aalRes.error) {
      console.error('[Auth] Błąd pobierania AAL', aalRes.error);
    }

    const all = (factorsRes.data?.all ?? []) as Factor[];
    const totp = (factorsRes.data?.totp ?? []) as Factor[];
    const verifiedTotp = totp.find((f) => f.status === 'verified') ?? null;

    setMfa({
      factors: all,
      verifiedTotp,
      currentLevel: (aalRes.data?.currentLevel as Aal) ?? null,
      nextLevel: (aalRes.data?.nextLevel as Aal) ?? null,
      loading: false,
    });
  }, []);

  useEffect(() => {
    let mounted = true;

    // UWAGA: w supabase-js v2 callback onAuthStateChange trzyma NavigatorLock.
    // Dlatego NIE wolno tu robić `await` na zapytaniach do bazy - odkładamy je
    // przez setTimeout, żeby uciec z lock context (inaczej deadlock i infinite loading).
    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
      // supabase-js przekazuje token do Realtime tylko przy SIGNED_IN / TOKEN_REFRESHED. Po weryfikacji
      // TOTP kanały miałyby do odświeżenia tokenu claims aal1, a polityki is_aal2() odrzucałyby zdarzenia.
      // Jawny token nie sięga po sesję, więc wywołanie jest bezpieczne pod blokadą callbacku.
      if (event === 'MFA_CHALLENGE_VERIFIED' && newSession?.access_token) {
        void supabase.realtime.setAuth(newSession.access_token);
      }
      // Supabase przy powrocie do karty (visibilitychange) wywołuje _recoverAndRefresh()
      // i może emitować TOKEN_REFRESHED lub SIGNED_IN nawet gdy user i dane się nie zmieniły.
      // W obu przypadkach pomijamy re-fetch jeśli załadowany profil już pasuje do usera w sesji.
      const userId = newSession?.user?.id;
      // Wylogowanie / wygasła sesja / inny user niż dotąd → czyścimy dane klienta zanim cokolwiek
      // wyrenderuje się z nową sesją. Start bez sesji czyści tylko "Ostatnie" (cache jest wtedy pusty),
      // pierwsze załadowanie z sesją (null → user) nie czyści nic.
      const prevUserId = sessionUserIdRef.current;
      if (prevUserId != null && prevUserId !== userId) {
        clearClientData();
      } else if (userId == null) {
        clearRecent();
      }
      sessionUserIdRef.current = userId ?? null;
      // Link odzyskania hasła (admin "wyślij link" / reset) - sesja ma prawa zwykłego logowania,
      // więc zanim user wejdzie dalej, musi ustawić nowe hasło (jak po zaproszeniu).
      if (event === 'PASSWORD_RECOVERY' && userId) {
        writeRecoveryUserId(userId);
        setRecoveryUserId(userId);
      } else if (userId == null || (prevUserId != null && prevUserId !== userId)) {
        writeRecoveryUserId(null);
        setRecoveryUserId(null);
      }
      if (
        (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') &&
        userId != null &&
        loadedUserIdRef.current === userId
      ) {
        // Aktualizuj sesję (nowy token potrzebny dla supabase client), ale nie ruszaj
        // profilu/MFA — dane użytkownika się nie zmieniły.
        setSession(newSession);
        return;
      }
      // Kod TOTP tego samego usera (ekran 2FA albo ponowne potwierdzenie w Profilu): MFA odświeżamy
      // w tle, bez `loading` - ProtectedRoute nie odmontowuje wtedy otwartego modułu ani dialogu.
      if (event === 'MFA_CHALLENGE_VERIFIED' && userId != null && loadedUserIdRef.current === userId) {
        setSession(newSession);
        setTimeout(() => {
          if (mounted) void fetchMfa();
        }, 0);
        return;
      }
      setSession(newSession);
      if (userId) {
        setMfa((prev) => ({ ...prev, loading: true }));
        setTimeout(() => {
          if (!mounted) return;
          void Promise.all([fetchProfile(userId), fetchMfa()]).finally(() => {
            if (mounted) setLoading(false);
          });
        }, 0);
      } else {
        loadedUserIdRef.current = null;
        setProfile(null);
        setMfa(INITIAL_MFA);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [fetchProfile, fetchMfa, clearClientData]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async (scope: 'global' | 'local' = 'global') => {
    const userId = session?.user?.id;
    // Push tego urządzenia nie może trafiać do kolejnego użytkownika; best-effort, maks. 1,5 s.
    try {
      await Promise.race([removeThisDevicePush(), new Promise<void>((resolve) => setTimeout(resolve, 1500))]);
    } catch {
      // wylogowanie nigdy nie czeka na push
    }
    await supabase.auth.signOut({ scope });
    setProfile(null);
    setMfa(INITIAL_MFA);
    clearClientData();
    // Jawne wylogowanie (wspólne urządzenia): także niewysłane szkice newslettera. Nie przy samym
    // wygaśnięciu sesji - wtedy szkic ma przetrwać ponowne zalogowanie.
    clearNewsletterDrafts();
    writeRecoveryUserId(null);
    setRecoveryUserId(null);
    if (userId) setPrivacyLocked(userId, false);
  }, [session?.user?.id, clearClientData]);

  const refreshProfile = useCallback(async () => {
    if (session?.user) await fetchProfile(session.user.id);
  }, [session?.user, fetchProfile]);

  const clearPasswordRecovery = useCallback(() => {
    writeRecoveryUserId(null);
    setRecoveryUserId(null);
  }, []);

  const passwordRecovery = recoveryUserId != null && recoveryUserId === session?.user?.id;

  // Profil ładowany raz na sesję nie zauważy dezaktywacji konta - odświeżamy go po powrocie
  // do karty i co 5 minut. ProtectedRoute przekieruje wtedy na /login?reason=inactive.
  const sessionUserId = session?.user?.id;
  useEffect(() => {
    if (!sessionUserId) return;
    const refresh = () => void fetchProfile(sessionUserId, true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(refresh, PROFILE_REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [sessionUserId, fetchProfile]);

  const refreshMfa = useCallback(async () => {
    if (session?.user) {
      setMfa((prev) => ({ ...prev, loading: true }));
      await fetchMfa();
    }
  }, [session?.user, fetchMfa]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      mfa,
      passwordRecovery,
      signIn,
      signOut,
      refreshProfile,
      refreshMfa,
      clearPasswordRecovery,
    }),
    [session, profile, loading, mfa, passwordRecovery, signIn, signOut, refreshProfile, refreshMfa, clearPasswordRecovery],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth musi być użyty wewnątrz <AuthProvider>');
  return ctx;
}

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom';
import {
  Briefcase, Calendar, FileText, Loader2, Shield, ShieldAlert, Users, Wallet, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { AuthBackdrop, AuthHeader, AuthLayout } from '@/components/auth/AuthLayout';
import { supabase } from '@/integrations/supabase/client';
import type { AppRole } from '@/integrations/supabase/types';
import { isAdmin } from '@/lib/permissions';
import { useAuth } from '@/contexts/AuthContext';
import { useMpForms } from '@/hooks/useMpForms';
import { MfaEnrollmentScreen } from '@/routes/MfaEnrollmentScreen';
import { MfaChallengeScreen } from '@/routes/MfaChallengeScreen';

// Te same role co tokeny MCP i backend /api/oauth/code (Asystent nie ma dostępu do Claude).
const OAUTH_ROLES: readonly AppRole[] = ['posel', 'administrator', 'pracownik'];

// Zakres zależy od roli - narzędzia MCP egzekwują te same uprawnienia co aplikacja.
function scopeItems(isPosel: boolean) {
  return [
    { icon: Briefcase, label: 'Sprawy wyborców', desc: 'Lista, szczegóły, tworzenie, zmiana statusu, notatki' },
    { icon: Users, label: 'Kontakty', desc: 'Przeglądanie i wyszukiwanie kontaktów biura' },
    { icon: Calendar, label: 'Kalendarz', desc: 'Nadchodzące wydarzenia, tworzenie, edycja' },
    isPosel
      ? { icon: FileText, label: 'Interpelacje', desc: 'Lista, szczegóły, decyzje i potwierdzanie wysyłki' }
      : { icon: FileText, label: 'Interpelacje', desc: 'Lista, szczegóły, wgrywanie nowych wersji i potwierdzanie wysyłki' },
    isPosel
      ? { icon: Wallet, label: 'Budżet', desc: 'Wydatki biura: przeglądanie, dodawanie, edycja' }
      : { icon: Wallet, label: 'Budżet', desc: 'Wydatki biura (tylko odczyt)' },
  ];
}

type ConsentAction = 'describe' | 'approve' | 'deny';

interface ConsentResponse {
  client_name?: string;
  redirect_url?: string;
  error?: string;
  error_description?: string;
}

class SessionExpiredError extends Error {}

// Wszystkie akcje ekranu zgody idą przez serwer (/api/oauth/code), który waliduje
// klienta i redirect_uri. Frontend nigdy nie buduje URL-a przekierowania sam.
async function callConsentApi(action: ConsentAction, payload: Record<string, string>): Promise<ConsentResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new SessionExpiredError('Brak aktywnej sesji — zaloguj się ponownie');

  const res = await fetch('/api/oauth/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({})) as ConsentResponse;
  if (!res.ok) throw new Error(data.error_description ?? data.error ?? 'Nieznany błąd serwera');
  return data;
}

// Ostatnia linia obrony przed javascript:/data: - przekierowujemy tylko na http(s).
function navigateToRedirect(redirectUrl: string | undefined) {
  let url: URL;
  try {
    url = new URL(redirectUrl ?? '');
  } catch {
    throw new Error('Serwer zwrócił nieprawidłowy adres przekierowania');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Serwer zwrócił nieprawidłowy adres przekierowania');
  }
  window.location.href = url.toString();
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { session, profile, mfa, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [clientName, setClientName] = useState<string | null>(null);
  const [describeError, setDescribeError] = useState<string | null>(null);
  const mp = useMpForms();

  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const codeChallenge = params.get('code_challenge') ?? '';
  const codeChallengeMethod = params.get('code_challenge_method') ?? 'S256';
  const state = params.get('state') ?? '';
  const scope = params.get('scope') ?? 'mcp';

  const hasParams = Boolean(clientId && redirectUri && codeChallenge);
  const isAal2 = mfa.currentLevel === 'aal2';
  const userId = session?.user.id ?? null;
  const canAuthorize = Boolean(profile && OAUTH_ROLES.includes(profile.role));

  // Nazwa aplikacji pochodzi z bazy (po client_id), nie z parametrów URL.
  useEffect(() => {
    if (!userId || !hasParams || !isAal2 || !canAuthorize) return;
    let cancelled = false;
    setClientName(null);
    setDescribeError(null);
    callConsentApi('describe', { client_id: clientId, redirect_uri: redirectUri })
      .then((data) => {
        if (cancelled) return;
        if (!data.client_name) throw new Error('Nieznana aplikacja');
        setClientName(data.client_name);
      })
      .catch((err: unknown) => {
        if (!cancelled) setDescribeError(err instanceof Error ? err.message : 'Nieznany błąd');
      });
    return () => { cancelled = true; };
  }, [userId, hasParams, isAal2, canAuthorize, clientId, redirectUri]);

  // Auth loading
  if (authLoading || mfa.loading) {
    return (
      <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-background">
        <AuthBackdrop />
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Ładowanie" />
      </div>
    );
  }

  // Niezalogowany — redirect na login, po zalogowaniu wróć tutaj
  if (!session || !profile) {
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent('/oauth/consent?' + params.toString())}`}
        replace
      />
    );
  }

  // Zgoda wymaga sesji po drugim składniku (aal2) - jak w ProtectedRoute.
  if (!mfa.verifiedTotp) return <MfaEnrollmentScreen />;
  if (!isAal2) return <MfaChallengeScreen />;

  // Asystent nie może podłączać Claude - backend i tak odrzuci, ale pokazujemy jasny komunikat.
  if (!canAuthorize) {
    return (
      <AuthLayout className="min-h-screen" contentClassName="max-w-sm">
        <AuthHeader
          icon={ShieldAlert}
          iconTone="destructive"
          title="Brak uprawnień"
          description={`Tylko ${mp.nominative}, Administrator lub Pracownik może autoryzować dostęp Claude do portalu biura`}
        />
      </AuthLayout>
    );
  }

  // Walidacja po stronie frontu
  if (!hasParams || describeError) {
    return (
      <AuthLayout className="min-h-screen" contentClassName="max-w-sm">
        <AuthHeader
          icon={ShieldAlert}
          iconTone="destructive"
          title="Nieprawidłowe żądanie"
          description={describeError ?? 'Nieprawidłowe parametry autoryzacji. Wróć do aplikacji i spróbuj ponownie.'}
        />
      </AuthLayout>
    );
  }

  if (!clientName) {
    return (
      <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-background">
        <AuthBackdrop />
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Ładowanie" />
      </div>
    );
  }

  const submit = async (action: 'approve' | 'deny') => {
    setLoading(true);
    try {
      const data = await callConsentApi(action, {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        state,
        scope,
      });
      navigateToRedirect(data.redirect_url);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        toast.error(err.message);
        navigate('/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search));
        return;
      }
      toast.error(action === 'approve' ? 'Autoryzacja nie powiodła się' : 'Nie udało się odmówić dostępu', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
      setLoading(false);
    }
  };

  return (
    <AuthLayout className="min-h-screen" footer={<span className="break-all font-mono text-[11px]">{clientId}</span>}>
      <AuthHeader
        icon={Shield}
        title={clientName}
        description="prosi o dostęp do Twojego konta w portalu biura"
      />

      <div className="mt-6 space-y-5">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
          <span>Zalogowany jako</span>
          <span className="truncate font-medium text-foreground">{profile.full_name ?? profile.email}</span>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Zakres dostępu</p>
          <ul className="divide-y rounded-xl border">
            {scopeItems(isAdmin(profile.role)).map(({ icon: Icon, label, desc }) => (
              <li key={label} className="flex items-start gap-3 px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
          {!isAdmin(profile.role) && (
            <p className="mt-2 text-xs text-muted-foreground">
              Claude widzi tylko dane z Twojego zakresu, tak jak w aplikacji.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
          Dostęp wygasa po <strong>30 dniach</strong> lub wcześniej, po unieważnieniu tokena albo aplikacji w{' '}
          <strong>/biuro/admin/integracje/mcp</strong>.
        </div>

        <div className="flex flex-col-reverse gap-2 max-md:gap-3 md:flex-row">
          <Button
            variant="outline"
            size="lg"
            className="w-full md:flex-1"
            onClick={() => submit('deny')}
            disabled={loading}
          >
            <X className="mr-1 h-4 w-4" />
            Odmów
          </Button>
          <Button
            size="lg"
            className="w-full md:flex-1"
            onClick={() => submit('approve')}
            disabled={loading}
          >
            {loading
              ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              : <Shield className="mr-1 h-4 w-4" />}
            Zatwierdź
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}

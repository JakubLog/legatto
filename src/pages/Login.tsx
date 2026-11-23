import { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthBackdrop, AuthHeader, AuthLayout } from '@/components/auth/AuthLayout';
import { ProfilePicker } from '@/components/auth/ProfilePicker';
import { TrustedPinForm } from '@/components/auth/TrustedPinForm';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { usePublicSite } from '@/hooks/usePublicSite';
import { safeRedirectPath } from '@/lib/safeRedirect';
import {
  forgetRememberedProfile,
  isDeviceUsable,
  listRememberedProfiles,
  setRememberIntent,
  type RememberedProfile,
} from '@/lib/trustedDevice';
import { toast } from 'sonner';

const schema = z.object({
  email: z.string().email('Nieprawidłowy adres email'),
  password: z.string().min(8, 'Hasło musi mieć min. 8 znaków'),
});

type FormValues = z.infer<typeof schema>;

/** Przykładowy adres z domeny instancji (biuro.kowalski.pl -> ty@kowalski.pl); lokalnie ty@example.pl. */
function emailPlaceholder(): string {
  const host = window.location.hostname.replace(/^(www|biuro)\./, '');
  const isDomain = host.includes('.') && !/^[\d.]+$/.test(host);
  return `ty@${isDomain ? host : 'example.pl'}`;
}

export default function Login() {
  const { session, profile, signIn, signOut, loading } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  // Profile zapamiętane na tym komputerze (null = jeszcze się wczytują) i bieżący krok ekranu.
  const [remembered, setRemembered] = useState<RememberedProfile[] | null>(null);
  const [view, setView] = useState<'picker' | 'pin' | 'password'>('picker');
  const [selected, setSelected] = useState<RememberedProfile | null>(null);
  const [remember, setRemember] = useState(true);
  // Ekran logowania jest anonimowy: marka posła z /api/public-site (anon nie ma get_public_*).
  const { data: site } = usePublicSite();
  const district = site?.identity.district_label ?? '';

  const reason = searchParams.get('reason');
  // Cel po zalogowaniu: `?redirect=` (np. powrót na /oauth/consent?...) tylko jako ścieżka w tym
  // samym originie, inaczej trasa zapamiętana przez ProtectedRoute, domyślnie /biuro.
  const stateFrom = (location.state as { from?: { pathname: string; search?: string; hash?: string } } | null)?.from;
  const from =
    safeRedirectPath(searchParams.get('redirect')) ??
    (stateFrom ? `${stateFrom.pathname}${stateFrom.search ?? ''}${stateFrom.hash ?? ''}` : '/biuro');

  // Wyloguj sesje gdy auth user istnieje ale nie ma profilu (zapobiega pętli redirectow)
  // albo konto zdezaktywowano - token nie może zostać w localStorage (wspólne urządzenia).
  // Sesję nieaktywnego konta serwer już unieważnił, więc wystarczy wylogowanie lokalne.
  useEffect(() => {
    if (!session) return;
    if (reason === 'no_profile' && !profile) {
      void signOut();
    } else if (reason === 'inactive' && profile && !profile.is_active) {
      void signOut('local');
    }
  }, [reason, session, profile, signOut]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const reloadRemembered = useCallback(() => listRememberedProfiles().then(setRemembered), []);
  useEffect(() => {
    void reloadRemembered();
  }, [reloadRemembered]);

  if (loading || remembered === null) {
    return (
      <div className="relative isolate flex h-full items-center justify-center overflow-hidden bg-background">
        <AuthBackdrop />
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Ładowanie" />
      </div>
    );
  }

  if (session && profile && profile.is_active) {
    return <Navigate to={from} replace />;
  }

  const currentView = view === 'picker' && remembered.length === 0 ? 'password' : view;

  const openPassword = (target: RememberedProfile | null) => {
    setSelected(target);
    form.reset({ email: target?.email ?? '', password: '' });
    setView('password');
    // Nieudane logowanie z profilu mogło zdjąć zaufanie - kafelek pokaże wtedy "Hasło + kod 2FA".
    void reloadRemembered();
  };

  const selectProfile = (target: RememberedProfile) => {
    if (!isDeviceUsable(target.device)) {
      openPassword(target);
      return;
    }
    setSelected(target);
    setView('pin');
  };

  const backToPicker = () => {
    setSelected(null);
    form.reset({ email: '', password: '' });
    setView('picker');
  };

  const forgetProfile = async (target: RememberedProfile) => {
    await forgetRememberedProfile(target);
    toast.success('Profil usunięty z tego komputera');
    await reloadRemembered();
  };

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    // Odczyta go RememberThisDevice po przejściu 2FA (tylko dla tego samego adresu e-mail).
    setRememberIntent(values.email, remember);
    const { error } = await signIn(values.email, values.password);
    setSubmitting(false);

    if (error) {
      // Zdezaktywowane konto jest blokowane w Auth (ban) - komunikat GoTrue po angielsku.
      const banned = /banned/i.test(error);
      toast.error('Nie udało się zalogować', {
        description: banned ? 'Konto jest nieaktywne. Skontaktuj się z administratorem.' : error,
      });
      return;
    }
    toast.success('Zalogowano');
  };

  const description = district ? `Panel pracowników biura · ${district}` : 'Panel pracowników biura';

  return (
    <AuthLayout
      contentClassName={currentView === 'picker' ? 'max-w-xl' : undefined}
      footer="Konto zakładane przez administratora. Zapomniałeś hasła? Skontaktuj się z biurem."
    >
      {reason === 'inactive' && (
        <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          Konto jest nieaktywne. Skontaktuj się z administratorem.
        </div>
      )}
      {reason === 'no_profile' && (
        <div className="mb-6 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-medium">Konto nie zostało udostępnione w aplikacji.</p>
          <p className="text-xs">
            Twój użytkownik istnieje w Auth, ale brak wpisu w tabeli <code className="rounded bg-background/60 px-1">profiles</code>. Skontaktuj się z administratorem (lub zaseeduj profil w SQL Editor).
          </p>
        </div>
      )}

      {currentView === 'picker' && (
        <ProfilePicker
          profiles={remembered}
          onSelect={selectProfile}
          onOtherAccount={() => openPassword(null)}
          onForget={forgetProfile}
        />
      )}

      {currentView === 'pin' && selected && (
        <TrustedPinForm profile={selected} onPasswordRequired={openPassword} onBack={backToPicker} />
      )}

      {currentView === 'password' && (
        <>
          <AuthHeader
            title={selected ? `Witaj, ${selected.fullName.split(' ')[0]}!` : 'Zaloguj się'}
            description={selected ? 'Wpisz hasło, a potem kod z aplikacji authenticator.' : description}
          />

          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
            {selected ? (
              <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
                <CreatorAvatar
                  name={selected.fullName}
                  avatarUrl={selected.avatarSrc}
                  className="h-10 w-10 ring-0"
                  fallbackClassName="bg-primary text-sm text-primary-foreground"
                />
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium">{selected.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">{selected.email}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder={emailPlaceholder()}
                  className="h-10 max-md:h-11"
                  {...form.register('email')}
                />
                {form.formState.errors.email && (
                  <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="password">Hasło</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                autoFocus={selected != null}
                className="h-10 max-md:h-11"
                {...form.register('password')}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary max-md:h-5 max-md:w-5"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span className="space-y-0.5">
                <span className="block font-medium">Zapamiętaj mnie na tym komputerze</span>
                <span className="block text-xs text-muted-foreground">
                  Po wylogowaniu wybierzesz swój profil i zalogujesz się PIN-em trybu prywatnego oraz kodem
                  2FA, bez hasła (przez 30 dni). Bez ustawionego PIN-u profil podpowie tylko adres e-mail.
                </span>
              </span>
            </label>

            <Button type="submit" size="lg" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Zaloguj się
            </Button>

            {remembered.length > 0 && (
              <div className="text-center">
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground max-md:min-h-11 max-md:text-sm"
                  onClick={backToPicker}
                  disabled={submitting}
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Wybierz inny profil
                </button>
              </div>
            )}
          </form>
        </>
      )}
    </AuthLayout>
  );
}

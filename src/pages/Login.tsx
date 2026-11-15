import { useEffect, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthBackdrop, AuthHeader, AuthLayout } from '@/components/auth/AuthLayout';
import { useSiteContent } from '@/hooks/useSiteContent';
import { safeRedirectPath } from '@/lib/safeRedirect';
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
  const { data: site } = useSiteContent();
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

  if (loading) {
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

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
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

  return (
    <AuthLayout footer="Konto zakładane przez administratora. Zapomniałeś hasła? Skontaktuj się z biurem.">
      <AuthHeader
        title="Zaloguj się"
        description={district ? `Panel pracowników biura · ${district}` : 'Panel pracowników biura'}
      />

      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
        {reason === 'inactive' && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            Konto jest nieaktywne. Skontaktuj się z administratorem.
          </div>
        )}
        {reason === 'no_profile' && (
          <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
            <p className="font-medium">Konto nie zostało udostępnione w aplikacji.</p>
            <p className="text-xs">
              Twój użytkownik istnieje w Auth, ale brak wpisu w tabeli <code className="rounded bg-background/60 px-1">profiles</code>. Skontaktuj się z administratorem (lub zaseeduj profil w SQL Editor).
            </p>
          </div>
        )}

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

        <div className="space-y-1.5">
          <Label htmlFor="password">Hasło</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            className="h-10 max-md:h-11"
            {...form.register('password')}
          />
          {form.formState.errors.password && (
            <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
          )}
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Zaloguj się
        </Button>
      </form>
    </AuthLayout>
  );
}

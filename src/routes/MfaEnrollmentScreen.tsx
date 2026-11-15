import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthHeader, AuthLayout } from '@/components/auth/AuthLayout';

import { useAuth } from '@/contexts/AuthContext';
import {
  useChallengeAndVerifyTotp,
  useEnrollTotp,
  type EnrollResult,
} from '@/hooks/useMfa';

const verifySchema = z.object({
  code: z
    .string()
    .regex(/^\d{6}$/, 'Wpisz 6 cyfr z aplikacji authenticator'),
});
type VerifyValues = z.infer<typeof verifySchema>;

const STEPS = [
  <>
    Zainstaluj aplikację authenticator: <strong className="font-medium text-foreground">Google Authenticator</strong>,{' '}
    <strong className="font-medium text-foreground">Microsoft Authenticator</strong>,{' '}
    <strong className="font-medium text-foreground">1Password</strong>,{' '}
    <strong className="font-medium text-foreground">Authy</strong>.
  </>,
  <>Zeskanuj kod QR poniżej (lub wpisz klucz ręcznie).</>,
  <>Wpisz 6-cyfrowy kod, który pokaże się w aplikacji.</>,
];

export function MfaEnrollmentScreen() {
  const { profile, refreshMfa, signOut } = useAuth();
  const enrollMut = useEnrollTotp();
  const verifyMut = useChallengeAndVerifyTotp();

  const [enroll, setEnroll] = useState<EnrollResult | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const form = useForm<VerifyValues>({
    resolver: zodResolver(verifySchema),
    defaultValues: { code: '' },
  });

  // Inicjalizacja enrollment przy pierwszym mount
  useEffect(() => {
    let cancelled = false;
    void enrollMut
      .mutateAsync()
      .then((res) => {
        if (!cancelled) setEnroll(res);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error('Nie udało się przygotować 2FA', {
            description: err instanceof Error ? err.message : 'Nieznany błąd',
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onVerify = async (values: VerifyValues) => {
    if (!enroll) return;
    try {
      await verifyMut.mutateAsync({
        factorId: enroll.factorId,
        code: values.code,
        isEnrollment: true,
      });
      await refreshMfa();
      toast.success('2FA aktywne', {
        description: 'Kolejne logowania będą wymagać kodu z aplikacji.',
      });
      // ProtectedRoute przepuszcza juz po refreshMfa (verifiedTotp + aal2)
    } catch (err) {
      toast.error('Nieprawidłowy kod', {
        description: err instanceof Error ? err.message : 'Spróbuj ponownie.',
      });
      form.reset({ code: '' });
    }
  };

  return (
    <AuthLayout
      footer={
        <button
          type="button"
          className="min-h-10 rounded-lg px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          onClick={() => void signOut()}
        >
          Wyloguj się i wrócić później
        </button>
      }
    >
      <AuthHeader
        icon={ShieldCheck}
        title="Skonfiguruj 2FA"
        description={
          <>
            {profile?.full_name ? `Witaj, ${profile.full_name.split(' ')[0]}! ` : ''}
            Aby zwiększyć bezpieczeństwo konta, ustaw drugi składnik logowania (kod jednorazowy z aplikacji).
          </>
        }
      />

      <div className="mt-6 space-y-5">
        <ol className="space-y-3 rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">
          {STEPS.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>

        {enrollMut.isPending && !enroll && (
          <div className="flex flex-col items-center gap-3 rounded-xl border p-4">
            <Skeleton className="h-48 w-48 rounded-lg" />
            <Skeleton className="h-3 w-40" />
          </div>
        )}

        {enroll && (
          <>
            <div className="flex flex-col items-center gap-3 rounded-xl border p-4">
              {/* QR zawsze na białym tle - czytelność skanera także w trybie ciemnym. */}
              <div className="rounded-lg bg-white p-2 shadow-sm">
                <img
                  src={enroll.qrCode}
                  alt="QR code do skonfigurowania 2FA"
                  className="h-44 w-44"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="min-h-10 rounded-lg px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                {showSecret ? 'Ukryj klucz' : 'Nie mogę zeskanować — pokaż klucz'}
              </button>
              {showSecret && (
                <div className="w-full space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Klucz do ręcznego wpisania
                  </Label>
                  <code className="block break-all rounded-lg bg-muted px-3 py-2 text-center font-mono text-sm">
                    {enroll.secret}
                  </code>
                </div>
              )}
            </div>

            <form onSubmit={form.handleSubmit(onVerify)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="code" className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-muted-foreground" />
                  Kod z aplikacji
                </Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  autoFocus
                  className="h-14 rounded-xl text-center font-mono text-2xl max-md:h-14 md:text-2xl tracking-[0.5em] indent-[0.5em] placeholder:text-muted-foreground/40"
                  {...form.register('code')}
                />
                {form.formState.errors.code && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.code.message}
                  </p>
                )}
              </div>

              <Button type="submit" size="lg" className="w-full" disabled={verifyMut.isPending}>
                {verifyMut.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Potwierdź i aktywuj
              </Button>
            </form>
          </>
        )}
      </div>
    </AuthLayout>
  );
}

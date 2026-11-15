import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthHeader, AuthLayout } from '@/components/auth/AuthLayout';

import { useAuth } from '@/contexts/AuthContext';
import { useChallengeAndVerifyTotp } from '@/hooks/useMfa';
import { mailtoHref } from '@/lib/mailto';

const schema = z.object({
  code: z
    .string()
    .regex(/^\d{6}$/, 'Wpisz 6 cyfr z aplikacji authenticator'),
});
type Values = z.infer<typeof schema>;

// Kontakt w sprawie utraconego klucza 2FA: opcjonalny adres z builda instancji.
// Bez niego ekran odsyła do Posła/Administratora biura (reset w panelu Użytkownicy).
const SUPPORT_MAILTO = mailtoHref(import.meta.env.VITE_SUPPORT_EMAIL);

export function MfaChallengeScreen() {
  const { profile, mfa, refreshMfa, signOut } = useAuth();
  const verifyMut = useChallengeAndVerifyTotp();

  const factor = mfa.verifiedTotp;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { code: '' },
  });

  const onSubmit = async (values: Values) => {
    if (!factor) {
      toast.error('Brak skonfigurowanego klucza 2FA');
      return;
    }
    try {
      await verifyMut.mutateAsync({
        factorId: factor.id,
        code: values.code,
        isEnrollment: false,
      });
      await refreshMfa();
      // ProtectedRoute przepuszcza po podniesieniu AAL na aal2
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
          Wyloguj się
        </button>
      }
    >
      <AuthHeader
        icon={ShieldCheck}
        title="Weryfikacja 2FA"
        description={
          <>
            {profile?.full_name ? `Witaj, ${profile.full_name.split(' ')[0]}! ` : ''}
            Wpisz aktualny kod z aplikacji authenticator, aby kontynuować.
          </>
        }
      />

      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
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
            <p className="text-xs text-destructive">{form.formState.errors.code.message}</p>
          )}
          {factor?.friendly_name && (
            <p className="text-xs text-muted-foreground">
              Klucz: <span className="font-medium text-foreground">{factor.friendly_name}</span>
            </p>
          )}
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={verifyMut.isPending}>
          {verifyMut.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Zweryfikuj
        </Button>

        <p className="text-balance text-center text-xs text-muted-foreground">
          Zgubiłeś dostęp do aplikacji?{' '}
          {SUPPORT_MAILTO ? (
            <a
              href={`${SUPPORT_MAILTO}?subject=${encodeURIComponent('Reset 2FA')}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Skontaktuj się z pomocą techniczną
            </a>
          ) : profile?.role === 'posel' ? (
            // Od EDGE-6 konto Posła resetuje tylko inny Poseł (Administrator dostaje 403).
            'Reset 2FA konta Posła może wykonać tylko inny Poseł (Użytkownicy → Resetuj 2FA).'
          ) : (
            'Poproś Posła lub Administratora biura o reset 2FA (Użytkownicy → Resetuj 2FA).'
          )}
        </p>
      </form>
    </AuthLayout>
  );
}

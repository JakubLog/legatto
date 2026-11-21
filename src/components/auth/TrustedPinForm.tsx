import { useState, type FormEvent } from 'react';
import { ArrowLeft, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { AuthHeader } from '@/components/auth/AuthLayout';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signInWithTrustedDevice, TrustedDeviceError, type RememberedProfile } from '@/lib/trustedDevice';

interface TrustedPinFormProps {
  profile: RememberedProfile;
  /** Logowanie z profilu niemożliwe (zaufanie zdjęte, PIN zablokowany / usunięty) - dalej hasłem. */
  onPasswordRequired: (profile: RememberedProfile) => void;
  onBack: () => void;
}

/** Krok PIN-u po wyborze profilu; po nim ProtectedRoute pokazuje zwykły ekran kodu 2FA. */
export function TrustedPinForm({ profile, onPasswordRequired, onBack }: TrustedPinFormProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(pin) || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await signInWithTrustedDevice(profile, pin);
      // Sesja aal1 ustawiona - Login przekieruje do portalu, a ten poprosi o kod 2FA.
    } catch (err) {
      setPin('');
      setSubmitting(false);
      const code = err instanceof TrustedDeviceError ? err.code : 'server_error';
      const message = err instanceof Error ? err.message : 'Spróbuj ponownie.';
      if (code === 'bad_pin' || code === 'server_error' || code === 'bad_request') {
        setError(message);
        return;
      }
      toast.info('Zaloguj się hasłem', { description: message });
      onPasswordRequired(profile);
    }
  };

  return (
    <>
      <AuthHeader icon={KeyRound} title={`Witaj, ${profile.fullName.split(' ')[0]}!`} description="Wpisz PIN, a potem kod z aplikacji authenticator." />

      <div className="mt-5 flex items-center gap-3 rounded-xl bg-muted/50 p-3">
        <CreatorAvatar
          name={profile.fullName}
          avatarUrl={profile.avatarSrc}
          className="h-10 w-10 ring-0"
          fallbackClassName="bg-primary text-sm text-primary-foreground"
        />
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-medium">{profile.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{profile.email}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="trusted-pin">PIN</Label>
          <Input
            id="trusted-pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            autoComplete="off"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            disabled={submitting}
            aria-invalid={error ? true : undefined}
            className="h-12 rounded-xl text-center font-mono text-xl max-md:h-12 md:text-xl tracking-[0.5em] indent-[0.5em]"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">PIN trybu prywatnego (4-8 cyfr). 5 błędów blokuje PIN.</p>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={submitting || !/^\d{4,8}$/.test(pin)}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Dalej
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            onClick={onBack}
            disabled={submitting}
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Inny profil
          </button>
          <button
            type="button"
            className="min-h-10 rounded-lg px-2 font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => onPasswordRequired(profile)}
            disabled={submitting}
          >
            Zaloguj hasłem
          </button>
        </div>
      </form>
    </>
  );
}

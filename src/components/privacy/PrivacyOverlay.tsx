import { useState, type FormEvent } from 'react';
import { Eye, Loader2, LogOut } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/contexts/AuthContext';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { PrivacyPinLockedError, useVerifyPrivacyPin } from '@/hooks/usePrivacyPin';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { AuthBackdrop, AuthHeader } from '@/components/auth/AuthLayout';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRoleLabel } from '@/hooks/useMpForms';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function PrivacyOverlay() {
  const { profile, signOut } = useAuth();
  const { isLocked, unlock } = usePrivacy();
  const verify = useVerifyPrivacyPin();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const roleLabel = useRoleLabel();

  if (!isLocked || !profile) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pin) return;
    setError(null);
    try {
      const ok = await verify.mutateAsync(pin);
      setPin('');
      if (ok) {
        unlock();
        return;
      }
      // Licznik prob i blokada sa w DB - przeladowanie strony ich nie zeruje.
      setError('Niepoprawny PIN.');
    } catch (err) {
      setPin('');
      if (err instanceof PrivacyPinLockedError) {
        toast.error('PIN zablokowany', { description: `${err.message} Wylogowano dla bezpieczeństwa.` });
        await signOut();
        return;
      }
      setError(err instanceof Error ? err.message : 'Nie udalo sie zweryfikowac');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Tryb prywatny"
    >
      <div className="absolute inset-0 bg-background/70 backdrop-blur-2xl" aria-hidden="true" />

      <div className="relative isolate w-full max-w-sm">
        <AuthBackdrop className="-inset-24 overflow-visible" />
        <Card className="rounded-2xl p-6 shadow-popover max-md:p-4 md:p-8">
          <AuthHeader as="h2" icon={Eye} title="Włączono tryb prywatny" description="Wprowadź PIN, aby kontynuować." />

          <div className="mt-5 flex items-center gap-3 rounded-xl bg-muted/50 p-3">
            <Avatar className="h-10 w-10">
              {profile.avatar_url && (
                <AvatarImage
                  src={`${profile.avatar_url}?v=${profile.updated_at}`}
                  alt={profile.full_name}
                />
              )}
              <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">
                {initials(profile.full_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 text-left">
              <p className="truncate text-sm font-medium">{profile.full_name}</p>
              <p className="text-xs text-muted-foreground">{roleLabel(profile.role)}</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="privacy-overlay-pin">PIN</Label>
              <Input
                id="privacy-overlay-pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                autoComplete="off"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                disabled={verify.isPending}
                aria-invalid={error ? true : undefined}
                className="h-12 rounded-xl text-center font-mono text-xl max-md:h-12 md:text-xl tracking-[0.5em] indent-[0.5em]"
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={verify.isPending || !pin}>
              {verify.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Odsłoń ekran
            </Button>

            <div className="text-center">
              <button
                type="button"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground max-md:min-h-11 max-md:text-sm"
                onClick={() => void signOut()}
              >
                <LogOut className="h-3.5 w-3.5" />
                Wyloguj się
              </button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}

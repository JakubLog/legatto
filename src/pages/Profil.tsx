import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocation } from 'react-router-dom';
import { z } from 'zod';
import { CheckCircle2, Eye, KeyRound, Loader2, ShieldCheck, User as UserIcon, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { isAuthError } from '@supabase/supabase-js';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Page, PageHeader } from '@/components/layout/Page';
import { APP_MAIN_ID } from '@/components/layout/constants';
import { AvatarUploadButton } from '@/components/common/AvatarUploadButton';
import { AccessibilitySettingsSection } from '@/components/accessibility/AccessibilitySettingsSection';
import { SettingsSection } from '@/components/common/SettingsSection';
import { Mfa2FaCard } from '@/components/mfa/Mfa2FaCard';
import { NotificationSettingsSection } from '@/components/notifications/NotificationSettingsSection';
import { PrivacySetupDialog } from '@/components/privacy/PrivacySetupDialog';
import { TrustedDevicesCard } from '@/components/auth/TrustedDevicesCard';

import { useAuth } from '@/contexts/AuthContext';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { supabase } from '@/integrations/supabase/client';
import { useUpdateMyProfile } from '@/hooks/useUsers';
import { useChallengeAndVerifyTotp } from '@/hooks/useMfa';
import { useRoleLabel } from '@/hooks/useMpForms';
import {
  isReauthenticationNeeded,
  newPasswordSchema,
  passwordErrorMessage,
  PASSWORD_HINT,
  type NewPasswordValues,
} from '@/lib/password';

const profileSchema = z.object({
  full_name: z.string().min(2, 'Min. 2 znaki'),
  phone: z.string().optional(),
  is_public: z.boolean(),
});
type ProfileValues = z.infer<typeof profileSchema>;

export default function Profil() {
  const { profile, mfa, refreshProfile } = useAuth();
  const updateMut = useUpdateMyProfile();
  const verifyTotp = useChallengeAndVerifyTotp();
  const [pwSubmitting, setPwSubmitting] = useState(false);
  // Ponowne potwierdzenie przed zmianą hasła: obecne hasło + świeży kod 2FA.
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwCode, setPwCode] = useState('');
  // Kod z e-maila (auth.reauthenticate) - GoTrue wymaga go do zmiany hasła w sesji starszej niż 24 h.
  const [pwNonceSent, setPwNonceSent] = useState(false);
  const [pwNonce, setPwNonce] = useState('');
  const { isPinSet } = usePrivacy();
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const roleLabel = useRoleLabel();

  const profileForm = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { full_name: '', phone: '', is_public: true },
  });

  const passwordForm = useForm<NewPasswordValues>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  });

  useEffect(() => {
    if (!profile) return;
    profileForm.reset({
      full_name: profile.full_name,
      phone: profile.phone ?? '',
      is_public: profile.is_public,
    });
  }, [profile, profileForm]);

  // Link z e-maila i z panelu powiadomień: /biuro/profil#powiadomienia (sekcja pojawia się dopiero
  // po wczytaniu profilu). Przewijamy tylko obszar modułu: `scrollIntoView` przewijał też przodków
  // z `overflow: hidden` (cały szkielet aplikacji uciekał w górę, gdy sekcja była blisko końca strony).
  const { hash } = useLocation();
  const profileLoaded = Boolean(profile);
  useEffect(() => {
    if (hash !== '#powiadomienia' || !profileLoaded) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById('powiadomienia');
      const scroller = document.getElementById(APP_MAIN_ID);
      if (!target || !scroller) return;
      const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      scroller.scrollTo({ top, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash, profileLoaded]);

  if (!profile) {
    return (
      <Page narrow>
        <PageHeader icon={UserIcon} title="Mój profil" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </Page>
    );
  }

  const onSaveProfile = async (values: ProfileValues) => {
    try {
      await updateMut.mutateAsync({
        id: profile.id,
        full_name: values.full_name.trim(),
        phone: values.phone?.trim() || null,
        is_public: values.is_public,
      });
      await refreshProfile();
      toast.success('Profil zaktualizowany');
    } catch (err) {
      toast.error('Błąd zapisu', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const onAvatarUploaded = async (url: string) => {
    await updateMut.mutateAsync({ id: profile.id, avatar_url: url });
    await refreshProfile();
  };

  const onAvatarRemoved = async () => {
    await updateMut.mutateAsync({ id: profile.id, avatar_url: null });
    await refreshProfile();
  };

  const sendReauthCode = async () => {
    const { error } = await supabase.auth.reauthenticate();
    if (error) throw error;
    setPwNonceSent(true);
    setPwNonce('');
    toast.info('Potwierdź zmianę hasła', {
      description: `Wysłaliśmy kod potwierdzający na ${profile?.email ?? 'Twój adres e-mail'}.`,
    });
  };

  const onResendReauthCode = async () => {
    setPwSubmitting(true);
    try {
      await sendReauthCode();
    } catch (err) {
      toast.error('Nie udało się wysłać kodu', { description: passwordErrorMessage(err) });
    } finally {
      setPwSubmitting(false);
    }
  };

  const onChangePassword = async (values: NewPasswordValues) => {
    const nonce = pwNonce.trim();
    if (!pwCurrent) {
      toast.error('Wpisz obecne hasło');
      return;
    }
    if (!pwNonceSent && !/^\d{6}$/.test(pwCode)) {
      toast.error('Wpisz 6-cyfrowy kod z aplikacji authenticator');
      return;
    }
    if (pwNonceSent && !nonce) {
      toast.error('Wpisz kod potwierdzający z e-maila');
      return;
    }
    setPwSubmitting(true);
    try {
      // Świeży kod 2FA przed zmianą hasła - sama otwarta sesja nie wystarcza. Przy drugim kroku
      // (kod z e-maila) kod 2FA jest już potwierdzony w tej próbie.
      if (!pwNonceSent) {
        if (!mfa.verifiedTotp) throw new Error('Brak skonfigurowanego klucza 2FA');
        try {
          await verifyTotp.mutateAsync({ factorId: mfa.verifiedTotp.id, code: pwCode });
        } catch {
          setPwCode('');
          toast.error('Nieprawidłowy kod 2FA', { description: 'Wpisz aktualny kod z aplikacji authenticator.' });
          return;
        }
      }
      // current_password: GoTrue sprawdza obecne hasło, gdy projekt ma włączone
      // "Require current password when updating" (bez tej opcji pole jest ignorowane).
      // Bez kodu z e-maila najpierw zwykła zmiana - serwer wymaga kodu tylko gdy sesja jest starsza niż 24 h.
      const { error } = await supabase.auth.updateUser(
        pwNonceSent
          ? { password: values.password, current_password: pwCurrent, nonce }
          : { password: values.password, current_password: pwCurrent },
      );
      if (error && !pwNonceSent && isReauthenticationNeeded(error)) {
        await sendReauthCode();
        return;
      }
      if (error) throw error;
      toast.success('Hasło zmienione');
      passwordForm.reset({ password: '', confirm: '' });
      setPwCurrent('');
      setPwCode('');
      setPwNonceSent(false);
      setPwNonce('');
    } catch (err) {
      const wrongCurrent =
        isAuthError(err) && (err.code === 'current_password_mismatch' || err.code === 'current_password_required');
      // Kod 2FA zużyty w tej próbie - kolejna wymaga nowego.
      setPwCode('');
      if (wrongCurrent) {
        setPwCurrent('');
        setPwNonceSent(false);
        setPwNonce('');
      }
      toast.error('Błąd zmiany hasła', {
        description: wrongCurrent ? 'Obecne hasło jest nieprawidłowe.' : passwordErrorMessage(err),
      });
    } finally {
      setPwSubmitting(false);
    }
  };

  return (
    <Page narrow>
      <PageHeader
        icon={UserIcon}
        title="Mój profil"
        description="Dane widoczne na publicznej stronie biura, bezpieczeństwo konta, powiadomienia i dostępność."
      />

      <section aria-label="Zdjęcie profilowe" className="space-y-3 rounded-xl border bg-card p-5 shadow-sm max-md:p-4">
        <AvatarUploadButton
          userId={profile.id}
          fullName={profile.full_name}
          currentUrl={profile.avatar_url}
          onUploaded={onAvatarUploaded}
          onRemoved={onAvatarRemoved}
          cacheKey={profile.updated_at}
          heading={
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 truncate text-base font-semibold">{profile.full_name}</p>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {roleLabel(profile.role)}
                </span>
              </div>
              <p className="break-all text-[13px] text-muted-foreground md:truncate">{profile.email}</p>
            </div>
          }
        />
        <p className="text-xs text-muted-foreground">
          Zdjęcie jest widoczne na publicznej liście pracowników biura. Brak zdjęcia → pokazujemy inicjały.
        </p>
      </section>

      <SettingsSection
        icon={UserRound}
        title="Dane podstawowe"
        description="Imię, nazwisko i telefon widoczne na publicznej stronie biura."
      >
        <form onSubmit={profileForm.handleSubmit(onSaveProfile)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Imię i nazwisko</Label>
            <Input id="full_name" {...profileForm.register('full_name')} />
            {profileForm.formState.errors.full_name && (
              <p className="text-xs text-destructive">{profileForm.formState.errors.full_name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Telefon kontaktowy</Label>
            <Input id="phone" type="tel" placeholder="+48 ..." {...profileForm.register('phone')} />
            <p className="text-xs text-muted-foreground">
              Widoczny na publicznej stronie biura przy nazwisku (jeśli profil jest publiczny).
            </p>
          </div>

          <label
            htmlFor="is_public"
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40"
          >
            <input
              id="is_public"
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-input accent-primary"
              checked={profileForm.watch('is_public')}
              onChange={(e) => profileForm.setValue('is_public', e.target.checked)}
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium leading-none">
                Pokaż mnie na publicznej liście pracowników
              </span>
              <span className="block text-xs text-muted-foreground">
                Twoje imię, rola, telefon i avatar będą widoczne dla niezalogowanych odwiedzających stronę biura.
              </span>
            </span>
          </label>

          <div className="flex justify-end">
            <Button type="submit" className="max-md:w-full" disabled={updateMut.isPending}>
              {updateMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Zapisz zmiany
            </Button>
          </div>
        </form>
      </SettingsSection>

      <SettingsSection
        icon={ShieldCheck}
        title="Zmiana hasła"
        description={PASSWORD_HINT}
      >
        <form onSubmit={passwordForm.handleSubmit(onChangePassword)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pw-current">Obecne hasło</Label>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={pwCurrent}
              onChange={(e) => setPwCurrent(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Nowe hasło</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...passwordForm.register('password')}
            />
            {passwordForm.formState.errors.password && (
              <p className="text-xs text-destructive">{passwordForm.formState.errors.password.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm">Powtórz hasło</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              {...passwordForm.register('confirm')}
            />
            {passwordForm.formState.errors.confirm && (
              <p className="text-xs text-destructive">{passwordForm.formState.errors.confirm.message}</p>
            )}
          </div>

          {!pwNonceSent && (
            <div className="space-y-1.5">
              <Label htmlFor="pw-totp">Kod z aplikacji authenticator</Label>
              <Input
                id="pw-totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={pwCode}
                onChange={(e) => setPwCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          )}

          {pwNonceSent && (
            <div className="space-y-1.5">
              <Label htmlFor="pw-nonce">Kod z e-maila</Label>
              <Input
                id="pw-nonce"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                value={pwNonce}
                onChange={(e) => setPwNonce(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Zmiana hasła wymaga potwierdzenia kodem wysłanym na {profile?.email ?? 'Twój adres e-mail'}.{' '}
                <button
                  type="button"
                  onClick={() => void onResendReauthCode()}
                  disabled={pwSubmitting}
                  className="font-medium text-primary hover:underline disabled:opacity-50"
                >
                  Wyślij nowy kod
                </button>
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" className="max-md:w-full" disabled={pwSubmitting}>
              {pwSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {pwNonceSent ? 'Potwierdź i zmień hasło' : 'Zmień hasło'}
            </Button>
          </div>
        </form>
      </SettingsSection>

      <Mfa2FaCard />

      <SettingsSection icon={Eye} title="Tryb prywatny" description="Zasłoń ekran i odblokuj go osobnym kodem PIN.">
        <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center @sm:justify-between">
          <p className="flex items-start gap-2 text-sm">
            {isPinSet ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            ) : (
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span>
              {isPinSet
                ? 'PIN jest ustawiony. Ekran zasłonisz ikoną oka na górnym pasku.'
                : 'Ustaw PIN, aby jednym kliknięciem zasłaniać poufne dane.'}
            </span>
          </p>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 max-md:w-full"
            onClick={() => setPrivacyOpen(true)}
          >
            {isPinSet ? 'Zarządzaj PIN-em' : 'Ustaw PIN'}
          </Button>
        </div>
      </SettingsSection>
      <PrivacySetupDialog open={privacyOpen} onOpenChange={setPrivacyOpen} />

      <TrustedDevicesCard />

      <AccessibilitySettingsSection />

      <div id="powiadomienia" className="scroll-mt-4">
        <NotificationSettingsSection />
      </div>
    </Page>
  );
}

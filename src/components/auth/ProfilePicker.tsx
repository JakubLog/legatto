import { useState } from 'react';
import { KeyRound, Plus, Settings2, X } from 'lucide-react';

import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { AuthHeader } from '@/components/auth/AuthLayout';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { isDeviceUsable, type RememberedProfile } from '@/lib/trustedDevice';
import { cn } from '@/lib/utils';

interface ProfilePickerProps {
  profiles: RememberedProfile[];
  onSelect: (profile: RememberedProfile) => void;
  onOtherAccount: () => void;
  onForget: (profile: RememberedProfile) => Promise<void>;
}

const TILE =
  'group relative flex min-h-36 flex-col items-center justify-center gap-2.5 rounded-xl border bg-card p-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Ekran "Kto korzysta?" - profile zapamiętane na tym komputerze. */
export function ProfilePicker({ profiles, onSelect, onOtherAccount, onForget }: ProfilePickerProps) {
  const [managing, setManaging] = useState(false);
  const [toForget, setToForget] = useState<RememberedProfile | null>(null);

  return (
    <>
      <AuthHeader
        title="Kto korzysta z portalu?"
        description={managing ? 'Wybierz profil, który chcesz usunąć z tego komputera.' : 'Wybierz swój profil, aby się zalogować.'}
      />

      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {profiles.map((profile) => {
          const quick = isDeviceUsable(profile.device);
          return (
            <li key={profile.userId}>
              <button
                type="button"
                className={cn(
                  TILE,
                  'w-full',
                  managing ? 'border-destructive/40 hover:bg-destructive/5' : 'hover:border-primary/40 hover:bg-muted/50',
                )}
                onClick={() => (managing ? setToForget(profile) : onSelect(profile))}
                aria-label={managing ? `Usuń profil: ${profile.fullName}` : `Zaloguj jako ${profile.fullName}`}
              >
                {managing && (
                  <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </span>
                )}
                <CreatorAvatar
                  name={profile.fullName}
                  avatarUrl={profile.avatarSrc}
                  className="h-16 w-16 ring-0"
                  fallbackClassName="bg-primary text-lg text-primary-foreground"
                />
                <span className="line-clamp-2 text-sm font-medium leading-tight">{profile.fullName}</span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {quick && <KeyRound className="h-3 w-3" aria-hidden />}
                  {quick ? 'PIN + kod 2FA' : 'Hasło + kod 2FA'}
                </span>
              </button>
            </li>
          );
        })}
        {!managing && (
          <li>
            <button
              type="button"
              className={cn(TILE, 'w-full border-dashed text-muted-foreground hover:bg-muted/50 hover:text-foreground')}
              onClick={onOtherAccount}
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Plus className="h-6 w-6" aria-hidden />
              </span>
              <span className="text-sm font-medium">Inne konto</span>
            </button>
          </li>
        )}
      </ul>

      <div className="mt-5 text-center">
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground max-md:min-h-11 max-md:text-sm"
          onClick={() => setManaging((v) => !v)}
        >
          <Settings2 className="h-3.5 w-3.5" aria-hidden />
          {managing ? 'Gotowe' : 'Zarządzaj profilami'}
        </button>
      </div>

      <AlertDialog open={toForget != null} onOpenChange={(open) => !open && setToForget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć profil z tego komputera?</AlertDialogTitle>
            <AlertDialogDescription>
              {toForget?.fullName} zniknie z ekranu wyboru, a ten komputer przestanie być zaufany dla tego
              konta. Konto zostaje bez zmian - kolejne logowanie tutaj wymaga hasła i kodu 2FA.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!toForget) return;
                void onForget(toForget).then(() => {
                  if (profiles.length <= 1) setManaging(false);
                });
                setToForget(null);
              }}
            >
              Usuń profil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

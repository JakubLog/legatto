import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Monitor } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsSection } from '@/components/common/SettingsSection';
import { useAuth } from '@/contexts/AuthContext';
import { useRevokeTrustedDevice, useTrustedDevices } from '@/hooks/useTrustedDevices';
import { listRememberedProfiles } from '@/lib/trustedDevice';
import { errorMessage } from '@/lib/errors';

const formatDate = (iso: string) => format(new Date(iso), 'd MMM yyyy', { locale: pl });

/** Profil: komputery, na których można się logować PIN-em + 2FA z ekranu wyboru profilu. */
export function TrustedDevicesCard() {
  const { profile } = useAuth();
  const { data: devices, isLoading, isError } = useTrustedDevices();
  const revoke = useRevokeTrustedDevice();
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null);

  const userId = profile?.id;
  useEffect(() => {
    if (!userId) return;
    void listRememberedProfiles().then((all) => {
      setThisDeviceId(all.find((p) => p.userId === userId)?.device?.id ?? null);
    });
  }, [userId, devices]);

  const handleRevoke = async (deviceId: string) => {
    try {
      await revoke.mutateAsync({ deviceId, thisComputerUserId: deviceId === thisDeviceId ? (userId ?? null) : null });
      toast.success('Komputer usunięty z zaufanych');
    } catch (err) {
      toast.error('Nie udało się usunąć komputera', { description: errorMessage(err) });
    }
  };

  return (
    <SettingsSection
      icon={Monitor}
      title="Zaufane komputery"
      description="Na tych komputerach wybierasz swój profil i logujesz się PIN-em trybu prywatnego oraz kodem 2FA, bez hasła. Zaufanie wygasa 30 dni po ostatnim logowaniu hasłem."
    >
      <div className="space-y-3">
        {!profile?.has_privacy_pin && (
          <p className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Ustaw PIN w sekcji „Tryb prywatny”, aby logować się z ekranu wyboru profilu bez hasła.
          </p>
        )}

        {isLoading ? (
          <Skeleton className="h-14 w-full" />
        ) : isError ? (
          <p className="text-sm text-destructive">Nie udało się wczytać listy komputerów.</p>
        ) : !devices?.length ? (
          <p className="text-sm text-muted-foreground">
            Brak zaufanych komputerów. Zaznacz „Zapamiętaj mnie na tym komputerze” przy logowaniu.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3 p-3 @max-md:flex-wrap">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {device.label}
                    {device.id === thisDeviceId && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        Ten komputer
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {device.last_used_at ? `Ostatnie logowanie PIN-em ${formatDate(device.last_used_at)}` : `Dodany ${formatDate(device.created_at)}`}
                    {' · '}ważny do {formatDate(device.expires_at)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 max-md:min-h-11 @max-md:w-full"
                  disabled={revoke.isPending}
                  onClick={() => void handleRevoke(device.id)}
                >
                  {revoke.isPending && revoke.variables?.deviceId === device.id && <Loader2 className="h-4 w-4 animate-spin" />}
                  Usuń
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsSection>
  );
}

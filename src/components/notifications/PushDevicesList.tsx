import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { BellOff, BellRing, Loader2, Monitor, Smartphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/admin/AdminUi';
import {
  useDisableThisDevicePush,
  useEnableThisDevicePush,
  useMyPushDevices,
  useRemovePushDevice,
  useThisDevicePush,
} from '@/hooks/useNotifications';
import { describeUserAgent, type NotificationsStatus, type PushDevice } from '@/lib/notifications';

const fmtDate = (iso: string) => format(new Date(iso), 'd MMM yyyy, HH:mm', { locale: pl });

interface PushDevicesListProps {
  status: NotificationsStatus['push'] | undefined;
  /** Po włączeniu push na tym urządzeniu (np. włączenie kanału push w preferencjach). */
  onEnabled?: () => void;
}

/** Push na tym urządzeniu (zgoda + subskrypcja) i lista moich zarejestrowanych urządzeń. */
export function PushDevicesList({ status, onEnabled }: PushDevicesListProps) {
  const deviceQ = useThisDevicePush();
  const devicesQ = useMyPushDevices();
  const enableMut = useEnableThisDevicePush();
  const disableMut = useDisableThisDevicePush();
  const removeMut = useRemovePushDevice();

  const device = deviceQ.data;
  const available = status?.available === true && Boolean(status.vapid_public_key);
  const busy = enableMut.isPending || disableMut.isPending;

  const enable = () => {
    if (!status?.vapid_public_key) return;
    enableMut.mutate(status.vapid_public_key, {
      onSuccess: () => {
        toast.success('Powiadomienia push włączone na tym urządzeniu');
        onEnabled?.();
      },
      onError: (err) => toast.error('Nie udało się włączyć powiadomień', { description: err.message }),
    });
  };

  const disable = () =>
    disableMut.mutate(undefined, {
      onSuccess: () => toast.success('Powiadomienia push wyłączone na tym urządzeniu'),
      onError: (err) => toast.error('Nie udało się wyłączyć powiadomień', { description: err.message }),
    });

  const remove = (d: PushDevice) =>
    removeMut.mutate(d.endpoint, {
      onSuccess: () => toast.success('Urządzenie usunięte'),
      onError: (err) => toast.error('Nie udało się usunąć urządzenia', { description: err.message }),
    });

  let notice: string | null = null;
  if (status && !available) notice = 'Powiadomienia push nie są włączone w biurze.';
  else if (device?.support === 'unsupported') notice = 'Ta przeglądarka nie obsługuje powiadomień push.';
  else if (device?.support === 'needs-install')
    notice =
      'Na iPhonie i iPadzie powiadomienia działają tylko w zainstalowanej aplikacji: w Safari wybierz Udostępnij → Do ekranu początkowego i otwórz Biuro z ikony na ekranie.';
  else if (device?.support === 'no-service-worker')
    notice = 'Powiadomienia push działają w wersji produkcyjnej albo w zainstalowanej aplikacji.';
  else if (device?.permission === 'denied')
    notice =
      'Powiadomienia są zablokowane dla tej strony. Odblokuj je w ustawieniach przeglądarki (ikona przy adresie strony) i odśwież stronę.';

  const canToggle = available && device?.support === 'ready' && device.permission !== 'denied';
  const devices = devicesQ.data ?? [];
  // Włączone = subskrypcja w przeglądarce ORAZ wiersz na serwerze (urządzenie mogło zostać
  // usunięte z innego urządzenia albo rejestracja mogła się nie udać).
  const subscribedHere =
    Boolean(device?.endpoint) &&
    device?.permission === 'granted' &&
    (devicesQ.data === undefined || devices.some((d) => d.endpoint === device.endpoint));

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 @sm:flex-row @sm:items-center @sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">To urządzenie</p>
          {deviceQ.isLoading ? (
            <Skeleton className="h-3 w-40" />
          ) : (
            <p className="text-xs text-muted-foreground">
              {notice ?? (subscribedHere ? 'Powiadomienia push są włączone.' : 'Powiadomienia push są wyłączone.')}
            </p>
          )}
        </div>
        {canToggle &&
          (subscribedHere ? (
            <Button type="button" variant="outline" size="sm" onClick={disable} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <BellOff />}
              Wyłącz na tym urządzeniu
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={enable} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <BellRing />}
              Włącz na tym urządzeniu
            </Button>
          ))}
      </div>

      {devicesQ.isLoading ? (
        <Skeleton className="h-12 w-full rounded-lg" />
      ) : devicesQ.error ? (
        <p className="text-xs text-destructive">Nie udało się wczytać urządzeń: {devicesQ.error.message}</p>
      ) : devices.length > 0 ? (
        <ul className="divide-y rounded-lg border" aria-label="Moje urządzenia z powiadomieniami push">
          {devices.map((d) => {
            const label = describeUserAgent(d.user_agent);
            const mobile = /iPhone|iPad|Android/.test(label);
            const Icon = mobile ? Smartphone : Monitor;
            return (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="truncate">{label}</span>
                    {d.endpoint === device?.endpoint && (
                      <StatusPill tone="primary" dot={false}>
                        To urządzenie
                      </StatusPill>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Dodano {fmtDate(d.created_at)} ·{' '}
                    {d.last_success_at ? `ostatnio dostarczono ${fmtDate(d.last_success_at)}` : 'jeszcze nic nie dostarczono'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => remove(d)}
                  disabled={removeMut.isPending}
                  aria-label={`Usuń urządzenie ${label}`}
                  title="Usuń urządzenie"
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bell, Loader2, Mail, Send, Smartphone, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsSection } from '@/components/common/SettingsSection';
import { PushDevicesList } from '@/components/notifications/PushDevicesList';
import { useAuth } from '@/contexts/AuthContext';
import { INSTANCE } from '@/lib/instance';
import {
  testErrorMessage,
  useMyNotificationPreferences,
  useMyPushDevices,
  useNotificationsStatus,
  useSaveMyNotificationPreferences,
  useSendTestNotification,
  type NotificationPreferencesPatch,
  type TestChannel,
  type TestResult,
} from '@/hooks/useNotifications';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_KINDS,
  WEEKDAYS,
  kindAvailableFor,
  type ChannelPrefs,
  type NotificationKindDef,
} from '@/lib/notifications';
import { isAdmin } from '@/lib/permissions';
import { cn } from '@/lib/utils';

function devicesLabel(n: number): string {
  if (n === 1) return '1 urządzenie';
  const mod10 = n % 10;
  const mod100 = n % 100;
  const few = mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14);
  return `${n} ${few ? 'urządzenia' : 'urządzeń'}`;
}

const CHANNEL_LABELS: Record<keyof ChannelPrefs, { short: string; aria: string }> = {
  email: { short: 'E-mail', aria: 'e-mail' },
  push: { short: 'Push', aria: 'push' },
  in_app: { short: 'Portal', aria: 'w portalu' },
};

/**
 * Preferencje powiadomień (każda rola). Każda zmiana przełącznika zapisuje się od razu
 * (częściowy zapis, optymistycznie w cache) - bez przycisku "Zapisz".
 */
export function NotificationSettingsSection() {
  const { profile } = useAuth();
  const statusQ = useNotificationsStatus();
  const prefsQ = useMyNotificationPreferences();
  const devicesQ = useMyPushDevices();
  const saveMut = useSaveMyNotificationPreferences();
  const testMut = useSendTestNotification();

  const save = (patch: NotificationPreferencesPatch) =>
    saveMut.mutate(patch, {
      onError: (err) => toast.error('Nie udało się zapisać ustawień powiadomień', { description: err.message }),
    });

  const sendTest = (channel: TestChannel) =>
    testMut.mutate(channel, {
      onSuccess: (res: TestResult) => {
        if (channel === 'email') {
          toast.success('Wysłano wiadomość testową', { description: profile?.email });
        } else {
          const sent = res.push?.sent ?? 0;
          const failed = res.push?.failed ?? 0;
          toast.success(`Wysłano test push na ${devicesLabel(sent)}`, {
            description: failed > 0 ? `Nie dotarło na ${devicesLabel(failed)}.` : undefined,
          });
        }
      },
      onError: (err) => toast.error('Nie udało się wysłać testu', { description: testErrorMessage(err) }),
    });

  const status = statusQ.data;
  const prefs = prefsQ.data;
  const role = profile?.role;

  let content;
  if (prefsQ.isLoading || !role) {
    content = (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">Ładuję ustawienia powiadomień...</span>
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  } else if (prefsQ.error || !prefs) {
    content = (
      <p className="text-sm text-destructive">
        Nie udało się wczytać ustawień powiadomień{prefsQ.error ? `: ${prefsQ.error.message}` : '.'}
      </p>
    );
  } else {
    // Wartości efektywne z serwera; domyślne z katalogu tylko gdy serwer nie zna jeszcze rodzaju.
    const rows = NOTIFICATION_KINDS.flatMap((def): { def: NotificationKindDef; value: ChannelPrefs }[] => {
      const value =
        prefs.kinds[def.key] ??
        (kindAvailableFor(def, role) ? { email: def.defaultEmail(role), push: def.defaultPush(role) } : null);
      return value ? [{ def, value }] : [];
    });
    const emailUnavailable = status?.email.available === false;
    // Kanał „w portalu” tylko, gdy serwer go zna (stara baza nie zwraca klucza in_app).
    const hasInApp = rows.some((r) => typeof r.value.in_app === 'boolean');
    const pushUnavailable = status?.push.available === false;
    const hasDevices = (devicesQ.data?.length ?? 0) > 0;

    content = (
      <div className="space-y-5">
        <div className="divide-y rounded-lg border">
          <MasterRow
            id="notif-email"
            icon={Mail}
            title="E-mail"
            detail={profile?.email || 'Brak adresu e-mail w profilu'}
            unavailable={
              emailUnavailable &&
              (!INSTANCE.email ? (
                'Wysyłka e-mail jest wyłączona przez operatora instancji.'
              ) : isAdmin(role) ? (
                <>
                  Wysyłka e-mail nie jest skonfigurowana. Skonfiguruj ją w{' '}
                  <Link to="/biuro/admin/integracje/powiadomienia" className="font-medium underline underline-offset-2">
                    Integracje → Powiadomienia
                  </Link>
                  .
                </>
              ) : (
                'Aby otrzymywać powiadomienia e-mail, poproś administratora o ich konfigurację.'
              ))
            }
            checked={prefs.email_enabled}
            onChange={(email_enabled) => save({ email_enabled })}
          />
          <MasterRow
            id="notif-push"
            icon={Smartphone}
            title="Push na urządzeniach"
            detail="Telefon i komputer, na których włączysz powiadomienia."
            note={pushUnavailable ? 'Powiadomienia push nie są jeszcze włączone w biurze.' : undefined}
            checked={prefs.push_enabled}
            onChange={(push_enabled) => save({ push_enabled })}
          />
        </div>

        <div className="space-y-4">
          {NOTIFICATION_CATEGORIES.map((cat) => {
            const catRows = rows.filter((r) => r.def.category === cat.key);
            if (catRows.length === 0) return null;
            return (
              <div key={cat.key} className="space-y-1.5">
                <div className="flex items-end gap-2 pl-1 pr-3 text-xs font-medium text-muted-foreground">
                  <h3 className="flex-1 font-semibold uppercase tracking-wide">{cat.label}</h3>
                  <span className={cn('w-12 text-center @max-sm:hidden', emailUnavailable && 'opacity-50')}>E-mail</span>
                  <span className="w-12 text-center @max-sm:hidden">Push</span>
                  {hasInApp && <span className="w-12 text-center @max-sm:hidden">Portal</span>}
                </div>
                <ul className="divide-y rounded-lg border">
                  {catRows.map(({ def, value }) => (
                    <li key={def.key} className="flex items-start gap-2 px-3 py-2.5 @max-sm:flex-col">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm font-medium leading-snug">{def.label}</p>
                        <p className="text-xs text-muted-foreground">{def.description}</p>
                        {def.key === 'weekly_digest' && (
                          <div className="flex flex-wrap items-center gap-2 pt-1.5">
                            <span className="text-xs text-muted-foreground">Dzień wysyłki</span>
                            <Select
                              value={String(prefs.weekly_digest_day)}
                              onValueChange={(v) => save({ weekly_digest_day: Number(v) })}
                              disabled={!value.email && !value.push}
                            >
                              <SelectTrigger className="h-8 w-40 text-[13px]" aria-label="Dzień podsumowania tygodnia">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {WEEKDAYS.map((d) => (
                                  <SelectItem key={d.value} value={String(d.value)}>
                                    {d.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2 @max-sm:flex-wrap @max-sm:gap-x-5 @max-sm:gap-y-2">
                        {(['email', 'push', 'in_app'] as const).map((channel) => {
                          if (channel === 'in_app' && !hasInApp) return null;
                          const checked = value[channel];
                          // Podsumowania nie mają kanału w portalu: pusta komórka kolumny.
                          if (typeof checked !== 'boolean') {
                            return <div key={channel} className="w-12 shrink-0 @max-sm:hidden" aria-hidden />;
                          }
                          const id = `notif-${def.key}-${channel}`;
                          const label = CHANNEL_LABELS[channel];
                          return (
                            <div
                              key={channel}
                              className="flex w-12 shrink-0 justify-center pt-0.5 @max-sm:w-auto @max-sm:items-center @max-sm:gap-2 @max-sm:pt-0"
                            >
                              <Switch
                                id={id}
                                checked={channel === 'email' && emailUnavailable ? false : checked}
                                disabled={
                                  channel === 'email'
                                    ? emailUnavailable || !prefs.email_enabled
                                    : channel === 'push'
                                      ? !prefs.push_enabled
                                      : false
                                }
                                onCheckedChange={(next) => save({ kinds: { [def.key]: { [channel]: next } } })}
                                aria-label={`${def.label}: ${label.aria}`}
                              />
                              <label htmlFor={id} className="hidden text-xs text-muted-foreground @max-sm:inline">
                                {label.short}
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="space-y-2 rounded-lg border p-3">
          <PushDevicesList
            status={status?.push}
            onEnabled={prefs.push_enabled ? undefined : () => save({ push_enabled: true })}
          />
        </div>

        <div className="flex flex-col gap-2 @sm:flex-row @sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => sendTest('email')}
            disabled={testMut.isPending || !status?.email.available}
          >
            {testMut.isPending && testMut.variables === 'email' ? <Loader2 className="animate-spin" /> : <Send />}
            Wyślij test e-mail
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => sendTest('push')}
            disabled={testMut.isPending || !status?.push.available || !hasDevices}
          >
            {testMut.isPending && testMut.variables === 'push' ? <Loader2 className="animate-spin" /> : <Send />}
            Wyślij test push
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SettingsSection
      icon={Bell}
      title="Powiadomienia"
      description="E-mail, push i powiadomienia w portalu (dzwonek) o sprawach, wydarzeniach, interpelacjach i bezpieczeństwie konta."
    >
      {content}
    </SettingsSection>
  );
}

interface MasterRowProps {
  id: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  note?: string;
  /** Kanał niedostępny w biurze: wiersz wyszarzony, przełącznik wyłączony, notatka jako ostrzeżenie. */
  unavailable?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function MasterRow({ id, icon: Icon, title, detail, note, unavailable, checked, onChange }: MasterRowProps) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground', unavailable && 'opacity-50')} aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <label
          htmlFor={id}
          className={cn('block text-sm font-medium leading-snug', unavailable ? 'text-muted-foreground' : 'cursor-pointer')}
        >
          {title}
        </label>
        <p className={cn('text-xs text-muted-foreground [overflow-wrap:anywhere]', unavailable && 'opacity-70')}>{detail}</p>
        {unavailable ? (
          <p id={`${id}-unavailable`} className="flex items-start gap-1.5 pt-1 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{unavailable}</span>
          </p>
        ) : (
          note && <p className="text-xs italic text-muted-foreground">{note}</p>
        )}
      </div>
      <Switch
        id={id}
        checked={unavailable ? false : checked}
        disabled={Boolean(unavailable)}
        onCheckedChange={onChange}
        aria-describedby={unavailable ? `${id}-unavailable` : undefined}
        className="mt-0.5"
      />
    </div>
  );
}

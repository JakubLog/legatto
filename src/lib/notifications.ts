import type { AppRole } from '@/integrations/supabase/types';
import { isAdmin } from '@/lib/permissions';

// Katalog rodzajów powiadomień - musi zgadzać się z migracją (get/set_my_notification_preferences)
// i api/notifications.ts. Kolejność w tablicy = kolejność wierszy w ustawieniach.

export type NotificationCategory =
  | 'bezpieczenstwo'
  | 'sprawy'
  | 'kalendarz'
  | 'interpelacje'
  | 'dokumenty'
  | 'obowiazki'
  | 'podsumowania';

export const NOTIFICATION_CATEGORIES: { key: NotificationCategory; label: string }[] = [
  { key: 'bezpieczenstwo', label: 'Bezpieczeństwo' },
  { key: 'sprawy', label: 'Sprawy' },
  { key: 'kalendarz', label: 'Kalendarz' },
  { key: 'interpelacje', label: 'Interpelacje' },
  { key: 'dokumenty', label: 'Dokumenty do podpisu' },
  { key: 'obowiazki', label: 'Obowiązki' },
  { key: 'podsumowania', label: 'Podsumowania' },
];

export type NotificationKind =
  | 'security_integration'
  | 'security_account'
  | 'case_assigned'
  | 'case_deadline'
  | 'case_mention'
  | 'case_comment'
  | 'public_submission'
  | 'event_assigned'
  | 'interpellation_review'
  | 'interpellation_decision'
  | 'signing_request'
  | 'signing_decision'
  | 'responsibility'
  | 'weekly_digest'
  | 'daily_digest';

export interface NotificationKindDef {
  key: NotificationKind;
  category: NotificationCategory;
  label: string;
  description: string;
  /** null = każda rola. */
  roles: AppRole[] | null;
  defaultEmail: (role: AppRole) => boolean;
  defaultPush: (role: AppRole) => boolean;
}

const yes = () => true;
const no = () => false;

export const NOTIFICATION_KINDS: NotificationKindDef[] = [
  {
    key: 'security_integration',
    category: 'bezpieczenstwo',
    label: 'Nowa usługa podłączona do konta',
    description: 'Token MCP, aplikacja OAuth (np. Claude), kalendarz ICS.',
    roles: null,
    defaultEmail: yes,
    defaultPush: yes,
  },
  {
    key: 'security_account',
    category: 'bezpieczenstwo',
    label: 'Zmiany bezpieczeństwa konta',
    description: 'Reset 2FA, wylogowanie ze wszystkich urządzeń, zmiana roli lub zakresu dostępu.',
    roles: null,
    defaultEmail: yes,
    defaultPush: yes,
  },
  {
    key: 'case_assigned',
    category: 'sprawy',
    label: 'Przypisanie sprawy',
    description: 'Ktoś przypisał Ci sprawę wyborcy.',
    roles: null,
    defaultEmail: yes,
    defaultPush: yes,
  },
  {
    key: 'case_deadline',
    category: 'sprawy',
    label: 'Termin sprawy',
    description: 'Dzień przed terminem Twojej otwartej sprawy.',
    roles: null,
    defaultEmail: yes,
    defaultPush: no,
  },
  {
    key: 'case_mention',
    category: 'sprawy',
    label: 'Wzmianka w komentarzu',
    description: 'Ktoś oznaczył Cię (@) w komentarzu do sprawy.',
    roles: null,
    defaultEmail: yes,
    defaultPush: yes,
  },
  {
    key: 'case_comment',
    category: 'sprawy',
    label: 'Komentarz w Twojej sprawie',
    description: 'Nowy komentarz w sprawie, którą prowadzisz albo utworzyłeś(-aś).',
    roles: null,
    defaultEmail: no,
    defaultPush: no,
  },
  {
    key: 'public_submission',
    category: 'sprawy',
    label: 'Nowe zgłoszenie z formularza',
    description: 'Wyborca wysłał zgłoszenie przez stronę publiczną.',
    roles: null,
    defaultEmail: (role) => isAdmin(role),
    defaultPush: (role) => isAdmin(role),
  },
  {
    key: 'event_assigned',
    category: 'kalendarz',
    label: 'Przypisanie wydarzenia',
    description: 'Ktoś przypisał Ci wydarzenie w kalendarzu.',
    roles: null,
    defaultEmail: yes,
    defaultPush: yes,
  },
  {
    key: 'interpellation_review',
    category: 'interpelacje',
    label: 'Interpelacja do decyzji',
    description: 'Nowa albo poprawiona interpelacja czeka na Twoją decyzję.',
    roles: ['posel', 'administrator'],
    defaultEmail: yes,
    defaultPush: yes,
  },
  {
    key: 'interpellation_decision',
    category: 'interpelacje',
    label: 'Decyzja w sprawie interpelacji',
    description: 'Akceptacja, uwagi albo odrzucenie Twojej interpelacji.',
    roles: null,
    defaultEmail: yes,
    defaultPush: yes,
  },
  {
    key: 'signing_request',
    category: 'dokumenty',
    label: 'Dokumenty do podpisu',
    description: 'Biuro przekazało nowe albo poprawione dokumenty do Twojego podpisu.',
    roles: ['posel', 'administrator'],
    defaultEmail: yes,
    defaultPush: yes,
  },
  {
    key: 'signing_decision',
    category: 'dokumenty',
    label: 'Obieg Twoich dokumentów',
    description: 'Twój dokument wrócił do poprawy, został podpisany albo wysłany.',
    roles: null,
    defaultEmail: yes,
    defaultPush: yes,
  },
  {
    key: 'responsibility',
    category: 'obowiazki',
    label: 'Obowiązki',
    description: 'Zostajesz opiekunem obszaru.',
    roles: null,
    defaultEmail: yes,
    defaultPush: yes,
  },
  {
    key: 'weekly_digest',
    category: 'podsumowania',
    label: 'Podsumowanie tygodnia',
    description: 'Przeterminowane i zbliżające się sprawy, wydarzenia tygodnia, interpelacje, budżet.',
    roles: null,
    defaultEmail: yes,
    defaultPush: no,
  },
  {
    key: 'daily_digest',
    category: 'podsumowania',
    label: 'Plan dnia',
    description: 'Rano: dzisiejsze wydarzenia i terminy, przeterminowane sprawy.',
    roles: null,
    defaultEmail: no,
    defaultPush: no,
  },
];

/** Etykieta rodzaju do list (historia wysyłek); 'test' = wiadomość testowa z ustawień. */
export function notificationKindLabel(kind: string): string {
  if (kind === 'test') return 'Test';
  return NOTIFICATION_KINDS.find((k) => k.key === kind)?.label ?? kind;
}

export function kindAvailableFor(def: NotificationKindDef, role: AppRole): boolean {
  return def.roles === null || def.roles.includes(role);
}

/** ISO: 1 = poniedziałek … 7 = niedziela. */
export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Poniedziałek' },
  { value: 2, label: 'Wtorek' },
  { value: 3, label: 'Środa' },
  { value: 4, label: 'Czwartek' },
  { value: 5, label: 'Piątek' },
  { value: 6, label: 'Sobota' },
  { value: 7, label: 'Niedziela' },
];

export interface ChannelPrefs {
  email: boolean;
  push: boolean;
  /** Brak klucza = rodzaj bez kanału „w aplikacji”. */
  in_app?: boolean;
}

/** Wynik `get_my_notification_preferences()`; `kinds` tylko dla rodzajów dostępnych dla roli. */
export interface NotificationPreferences {
  email_enabled: boolean;
  push_enabled: boolean;
  weekly_digest_day: number;
  kinds: Partial<Record<NotificationKind, ChannelPrefs>>;
}

/** Ustawienia instancji (op=admin_status / admin_save). */
export interface NotificationsSettings {
  email_enabled: boolean;
  push_enabled: boolean;
  from_email: string;
  from_name: string;
  reply_to: string;
  app_url: string;
  include_titles: boolean;
}

/** op=status (każda rola). */
export interface NotificationsStatus {
  email: { available: boolean };
  push: { available: boolean; vapid_public_key: string | null };
}

export interface ResendDomain {
  name: string;
  status: string;
}

/** op=admin_status (Poseł/Administrator). */
export interface NotificationsAdminStatus {
  settings: NotificationsSettings;
  key: { configured: boolean; hint: string | null };
  resend: null | { ok: boolean; code?: string; message?: string; domains?: ResendDomain[] };
  dispatch: { registered: boolean; pg_net: boolean };
  stats: { pending: number; failed_24h: number; sent_7d: number };
}

export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
export type ChannelStatus = 'sent' | 'failed' | 'skipped';

/** Wiersz `get_notification_deliveries(p_limit)`. */
export interface NotificationDelivery {
  id: string;
  created_at: string;
  kind: string;
  user_id: string;
  user_name: string | null;
  status: DeliveryStatus;
  email_status: ChannelStatus | null;
  push_status: ChannelStatus | null;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
}

export interface PushDevice {
  id: string;
  endpoint: string;
  user_agent: string | null;
  created_at: string;
  last_success_at: string | null;
}

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: 'W kolejce',
  sending: 'Wysyłanie',
  sent: 'Wysłane',
  failed: 'Błąd',
  skipped: 'Pominięte',
};

export const CHANNEL_STATUS_LABELS: Record<ChannelStatus, string> = {
  sent: 'wysłano',
  failed: 'błąd',
  skipped: 'pominięto',
};

/** Krótki opis urządzenia z user agenta: "Chrome · Android". */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Nieznane urządzenie';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS/.test(ua)
        ? 'Firefox'
        : /CriOS|Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Przeglądarka';
  const os = /iPhone|iPod/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;
  return os ? `${browser} · ${os}` : browser;
}

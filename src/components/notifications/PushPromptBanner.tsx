import { useState } from 'react';
import { BellRing, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/contexts/AuthContext';
import {
  useEnableThisDevicePush,
  useNotificationsStatus,
  useThisDevicePush,
} from '@/hooks/useNotifications';
import { isStandalonePwa } from '@/lib/pwa';

/**
 * Baner na pulpicie zainstalowanej aplikacji: push dostępny w biurze, a użytkownik jeszcze
 * nie odpowiedział na prośbę o zgodę. "×" chowa baner na stałe dla tego konta na tym urządzeniu.
 */
export function PushPromptBanner() {
  const { profile } = useAuth();
  const statusQ = useNotificationsStatus();
  const deviceQ = useThisDevicePush();
  const enableMut = useEnableThisDevicePush();
  const [dismissedNow, setDismissedNow] = useState(false);

  const storageKey = profile ? `biuro:push-prompt-dismissed:${profile.id}` : null;
  const vapidKey = statusQ.data?.push.vapid_public_key;
  const show =
    isStandalonePwa() &&
    !dismissedNow &&
    storageKey !== null &&
    localStorage.getItem(storageKey) !== '1' &&
    statusQ.data?.push.available === true &&
    deviceQ.data?.support === 'ready' &&
    deviceQ.data.permission === 'default';
  if (!show || !storageKey || !vapidKey) return null;

  const dismiss = () => {
    localStorage.setItem(storageKey, '1');
    setDismissedNow(true);
  };

  const enable = () =>
    enableMut.mutate(vapidKey, {
      onSuccess: () => toast.success('Powiadomienia push włączone na tym urządzeniu'),
      onError: (err) => toast.error('Nie udało się włączyć powiadomień', { description: err.message }),
    });

  return (
    <div className="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-foreground shadow-card">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <BellRing className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block font-medium">Włącz powiadomienia na tym urządzeniu</span>
        <span className="block text-xs text-muted-foreground">Przypisane sprawy, terminy i decyzje od razu na ekranie.</span>
      </span>
      <button
        type="button"
        onClick={enable}
        disabled={enableMut.isPending}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 max-md:h-11"
      >
        {enableMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Włącz
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:-mr-1 max-md:h-11 max-md:w-11"
        aria-label="Nie pokazuj więcej"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

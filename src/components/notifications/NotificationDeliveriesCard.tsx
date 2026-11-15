import { useState } from 'react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { ChevronDown, History, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState, ListSkeleton, LIST_ROW, SettingsCard, StatusPill, type PillTone } from '@/components/admin/AdminUi';
import { useNotificationDeliveries } from '@/hooks/useNotifications';
import {
  CHANNEL_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
  notificationKindLabel,
  type DeliveryStatus,
  type NotificationDelivery,
} from '@/lib/notifications';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<DeliveryStatus, PillTone> = {
  pending: 'info',
  sending: 'info',
  sent: 'success',
  failed: 'danger',
  skipped: 'neutral',
};

function channelsSummary(d: NotificationDelivery): string | null {
  const parts = [
    d.email_status && `e-mail: ${CHANNEL_STATUS_LABELS[d.email_status]}`,
    d.push_status && `push: ${CHANNEL_STATUS_LABELS[d.push_status]}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Tyle wierszy widać od razu - pełna lista po rozwinięciu, żeby strona ustawień nie miała kilku ekranów historii. */
const COLLAPSED_ROWS = 10;

/** Ostatnie wysyłki powiadomień w biurze (Poseł/Administrator). */
export function NotificationDeliveriesCard({ limit = 50 }: { limit?: number }) {
  const q = useNotificationDeliveries(limit);
  const rows = q.data ?? [];
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);

  return (
    <SettingsCard
      icon={History}
      title="Historia wysyłek"
      description={`Ostatnie ${limit} powiadomień.`}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => void q.refetch()}
          disabled={q.isFetching}
          aria-label="Odśwież historię"
          title="Odśwież"
        >
          <RefreshCw className={cn(q.isFetching && 'animate-spin')} />
        </Button>
      }
      footer={
        !expanded && rows.length > COLLAPSED_ROWS ? (
          <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setExpanded(true)}>
            <ChevronDown />
            Pokaż wszystkie ({rows.length})
          </Button>
        ) : undefined
      }
      flush
    >
      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.error ? (
        <p className="px-4 py-3 text-sm text-destructive">Nie udało się wczytać historii: {q.error.message}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={History} title="Brak wysyłek." />
      ) : (
        <ul className="divide-y">
          {visible.map((d) => {
            const channels = channelsSummary(d);
            return (
              <li key={d.id} className={cn(LIST_ROW, 'items-start')}>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
                    <span className="font-medium">{notificationKindLabel(d.kind)}</span>
                    <span className="truncate text-muted-foreground">{d.user_name ?? 'Nieznany użytkownik'}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(d.created_at), 'd MMM yyyy, HH:mm', { locale: pl })}
                    {channels && ` · ${channels}`}
                    {d.attempts > 1 && ` · prób: ${d.attempts}`}
                  </p>
                  {d.last_error && (
                    <p className="truncate text-xs text-destructive" title={d.last_error}>
                      {d.last_error}
                    </p>
                  )}
                </div>
                <StatusPill tone={STATUS_TONE[d.status] ?? 'neutral'} className="mt-0.5">
                  {DELIVERY_STATUS_LABELS[d.status] ?? d.status}
                </StatusPill>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsCard>
  );
}

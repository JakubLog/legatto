import { format, formatDistanceToNow } from 'date-fns';
import { pl } from 'date-fns/locale';
import { Ban, KeyRound, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorNotice,
  HOVER_REVEAL,
  LIST_ROW,
  ListSkeleton,
  SettingsCard,
  StatusPill,
} from '@/components/admin/AdminUi';
import { cn } from '@/lib/utils';
import type { McpToken } from '@/integrations/supabase/types';

function formatDate(value: string | null) {
  if (!value) return null;
  return format(new Date(value), 'd MMM yyyy, HH:mm', { locale: pl });
}

function formatRelative(value: string | null) {
  if (!value) return 'nigdy';
  return formatDistanceToNow(new Date(value), { addSuffix: true, locale: pl });
}

interface Props {
  tokens: McpToken[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onCreate: () => void;
  onRevoke: (t: McpToken) => void;
  onDelete: (t: McpToken) => void;
}

/** Lista tokenów MCP: status, prefix, ostatnie użycie, termin ważności, akcje unieważnij/usuń. */
export function McpTokensSection({ tokens, isLoading, error, onCreate, onRevoke, onDelete }: Props) {
  return (
    <SettingsCard
      icon={KeyRound}
      title="Tokeny MCP"
      description="Lista wszystkich kiedykolwiek wygenerowanych tokenów. Plaintext zachowywany jako sha256 — nieodtwarzalny po zamknięciu okna generowania."
      actions={
        <Button size="sm" onClick={onCreate}>
          <Plus />
          Wygeneruj token
        </Button>
      }
      flush
    >
      <div className="divide-y">
        {isLoading && <ListSkeleton rows={3} />}

        {error && (
          <div className="p-4">
            <ErrorNotice title="Nie udało się pobrać tokenów" message={error.message} />
          </div>
        )}

        {tokens && tokens.length === 0 && (
          <EmptyState
            icon={KeyRound}
            title="Brak tokenów. Wygeneruj pierwszy."
            action={
              <Button size="sm" variant="outline" onClick={onCreate}>
                <Plus />
                Wygeneruj token
              </Button>
            }
          />
        )}

        {tokens?.map((t) => {
          const revoked = Boolean(t.revoked_at);
          const expired = !revoked && t.expires_at !== null && new Date(t.expires_at) <= new Date();
          return (
            <div key={t.id} className={cn(LIST_ROW, (revoked || expired) && 'opacity-70')}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium leading-tight">
                  <span className="truncate">{t.name}</span>
                  <span className="font-mono text-xs font-normal text-muted-foreground">
                    epm_{t.token_prefix}…
                  </span>
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  {revoked ? (
                    <span>Unieważniony {formatRelative(t.revoked_at)}</span>
                  ) : (
                    <span title={formatDate(t.last_used_at) ?? ''}>
                      Ostatnio użyty: {t.last_used_at ? formatRelative(t.last_used_at) : 'nigdy'}
                    </span>
                  )}
                  <span>· Utworzony {formatDate(t.created_at)}</span>
                  {!revoked && (
                    <span>
                      · {t.expires_at ? `${expired ? 'Wygasł' : 'Ważny do'} ${formatDate(t.expires_at)}` : 'Bezterminowy'}
                    </span>
                  )}
                </p>
              </div>
              {revoked ? (
                <StatusPill tone="neutral">Unieważniony</StatusPill>
              ) : expired ? (
                <StatusPill tone="warning">Wygasł</StatusPill>
              ) : (
                <StatusPill tone="success">Aktywny</StatusPill>
              )}
              <div className="flex w-10 shrink-0 justify-end sm:w-[7.5rem]">
                {revoked ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(t)}
                    className={cn(
                      'h-10 px-2.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:h-8',
                      HOVER_REVEAL,
                    )}
                    aria-label="Usuń"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Usuń</span>
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRevoke(t)}
                    className={cn(
                      'h-10 px-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-8',
                      HOVER_REVEAL,
                    )}
                    aria-label="Unieważnij"
                  >
                    <Ban className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Unieważnij</span>
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </SettingsCard>
  );
}

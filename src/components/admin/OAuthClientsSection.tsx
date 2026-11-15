import { useState } from 'react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { Ban, Loader2, Plus, Shield } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  EmptyState,
  HOVER_REVEAL,
  LIST_ROW,
  ListSkeleton,
  SettingsCard,
  StatusPill,
} from '@/components/admin/AdminUi';
import { CreateOAuthClientDialog } from '@/components/admin/CreateOAuthClientDialog';
import { useOAuthClients, useRevokeOAuthClient, type OAuthClient } from '@/hooks/useOAuthClients';
import { cn } from '@/lib/utils';

/** Lista OAuth Apps (claude.ai) z tworzeniem i unieważnianiem. */
export function OAuthClientsSection() {
  const { data: clients, isLoading } = useOAuthClients();
  const revokeMut = useRevokeOAuthClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const handleRevoke = async (c: OAuthClient) => {
    setRevoking(c.client_id);
    try {
      await revokeMut.mutateAsync(c.client_id);
      toast.success('OAuth App unieważniona');
    } catch (err) {
      toast.error('Błąd', { description: err instanceof Error ? err.message : 'Nieznany błąd' });
    } finally {
      setRevoking(null);
    }
  };

  return (
    <>
      <SettingsCard
        icon={Shield}
        title="OAuth Apps"
        description={
          <>
            Dla integracji przez <strong>claude.ai (web)</strong> — generuj Client ID + Secret,
            wklej w Settings → Integrations. Autoryzacja przez OAuth 2.0.
          </>
        }
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            Nowa App
          </Button>
        }
        flush
      >
        <div className="divide-y">
          {isLoading && <ListSkeleton rows={2} />}
          {!isLoading && (!clients || clients.length === 0) && (
            <EmptyState icon={Shield} title="Brak OAuth Apps. Utwórz pierwszą dla claude.ai." />
          )}
          {clients?.map((c) => {
            const revoked = Boolean(c.revoked_at);
            const pending = revoking === c.client_id;
            return (
              <div key={c.client_id} className={cn(LIST_ROW, revoked && 'opacity-70')}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight">{c.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="break-all font-mono">{c.client_id}</span>
                    <span>· {format(new Date(c.created_at), 'd MMM yyyy', { locale: pl })}</span>
                  </p>
                </div>
                {revoked ? (
                  <StatusPill tone="neutral">Unieważniona</StatusPill>
                ) : (
                  <StatusPill tone="success">Aktywna</StatusPill>
                )}
                <div className="flex w-10 shrink-0 justify-end sm:w-[7.5rem]">
                  {!revoked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevoke(c)}
                      disabled={pending}
                      className={cn(
                        'h-10 px-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-8',
                        !pending && HOVER_REVEAL,
                      )}
                      aria-label="Unieważnij"
                    >
                      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                      <span className="hidden sm:inline">Unieważnij</span>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SettingsCard>
      <CreateOAuthClientDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

import { useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { pl } from 'date-fns/locale';
import { CalendarDays, Link2, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  EmptyState,
  HOVER_REVEAL,
  LIST_ROW,
  ListSkeleton,
  SettingsCard,
  StatusPill,
} from '@/components/admin/AdminUi';
import { AddIcsSourceDialog, DeleteIcsSourceDialog } from '@/components/admin/IcsSourceDialogs';

import { useIcsSources, useSyncIcsSource, type IcsSource } from '@/hooks/useIcsSources';
import { cn } from '@/lib/utils';

function SourceRow({
  src,
  syncing,
  onSync,
  onDelete,
}: {
  src: IcsSource;
  syncing: boolean;
  onSync: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={LIST_ROW}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
        <CalendarDays className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">{src.name}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate font-mono text-xs text-muted-foreground">
          <Link2 className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {src.url.length > 60 ? `${src.url.slice(0, 30)}…${src.url.slice(-20)}` : src.url}
          </span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground @sm:hidden">
          <SyncStatus src={src} />
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground @sm:flex">
        <SyncStatus src={src} />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button variant="ghost" size="sm" className="h-10 sm:h-8" onClick={onSync} disabled={syncing}>
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">Synchronizuj</span>
          <span className="sr-only sm:hidden">Synchronizuj</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          className={cn(
            'h-10 w-10 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:h-8 sm:w-8',
            HOVER_REVEAL,
          )}
          title="Usuń źródło"
          aria-label="Usuń źródło"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function SyncStatus({ src }: { src: IcsSource }) {
  if (!src.last_synced_at) {
    return <StatusPill tone="neutral">Nie zsynchronizowano</StatusPill>;
  }
  return (
    <>
      <StatusPill tone="success" title={format(new Date(src.last_synced_at), 'd MMM yyyy, HH:mm', { locale: pl })}>
        {formatDistanceToNow(new Date(src.last_synced_at), { addSuffix: true, locale: pl })}
      </StatusPill>
      <span className="tabular-nums">{src.synced_event_count} wydarzeń</span>
    </>
  );
}

export function IcsSourcesSection() {
  const { data: sources, isLoading } = useIcsSources();
  const sync = useSyncIcsSource();
  const [addOpen, setAddOpen] = useState(false);
  const [toDelete, setToDelete] = useState<IcsSource | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const handleSync = async (id: string) => {
    setSyncingId(id);
    try {
      await sync.mutateAsync(id);
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <>
      <SettingsCard
        icon={CalendarDays}
        title="Źródła kalendarzy"
        description="Prywatne linki ICS z Google, Apple lub Outlook. Synchronizacja automatyczna raz dziennie lub ręczna."
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus />
            Dodaj kalendarz
          </Button>
        }
        flush
      >
        <div className="divide-y">
          {isLoading && <ListSkeleton rows={2} avatar />}

          {!isLoading && (!sources || sources.length === 0) && (
            <EmptyState
              icon={CalendarDays}
              title="Brak źródeł. Dodaj pierwszy kalendarz ICS."
              action={
                <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                  <Plus />
                  Dodaj kalendarz
                </Button>
              }
            />
          )}

          {sources?.map((src) => (
            <SourceRow
              key={src.id}
              src={src}
              syncing={syncingId === src.id}
              onSync={() => handleSync(src.id)}
              onDelete={() => setToDelete(src)}
            />
          ))}
        </div>
      </SettingsCard>

      <AddIcsSourceDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <DeleteIcsSourceDialog source={toDelete} onClose={() => setToDelete(null)} />
    </>
  );
}

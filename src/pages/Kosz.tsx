import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { Loader2, Paperclip, RotateCcw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { FilterChip } from '@/components/common/FilterChip';
import { Page, PageHeader } from '@/components/layout/Page';
import { useAuth } from '@/contexts/AuthContext';
import {
  TRASH_ENTITY_LABELS,
  useEmptyTrash,
  usePurgeTrash,
  useRestoreTrash,
  useTrash,
  type TrashEntity,
  type TrashItem,
} from '@/hooks/useTrash';
import { errorMessage } from '@/lib/errors';
import { isAdmin } from '@/lib/permissions';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysLeftLabel(purgeAfter: string): string {
  const days = Math.max(0, Math.ceil((new Date(purgeAfter).getTime() - Date.now()) / DAY_MS));
  if (days <= 1) return 'usunie się trwale w ciągu doby';
  return `usunie się trwale za ${days} dni`;
}

function extrasLabel(item: TrashItem): string | null {
  const parts: string[] = [];
  if (item.items > 0) parts.push(`+${item.items} powiązanych`);
  if (item.files > 0) parts.push(`pliki: ${item.files}`);
  return parts.length ? parts.join(' · ') : null;
}

type Confirm = { kind: 'purge'; item: TrashItem } | { kind: 'empty' } | null;

/**
 * Kosz: usunięte rekordy (sprawy z załącznikami i komentarzami, kontakty, interpelacje, wydatki
 * z paragonami, raporty budżetu, dokumenty do podpisu) przez 7 dni, z przywracaniem. Poseł
 * i administrator widzą wszystko i mogą usuwać trwale; pozostali widzą to, co sami usunęli.
 */
export default function Kosz() {
  const { profile } = useAuth();
  const admin = isAdmin(profile?.role);
  const { data: items = [], isLoading, isError, refetch } = useTrash();
  const restoreMut = useRestoreTrash();
  const purgeMut = usePurgeTrash();
  const emptyMut = useEmptyTrash();
  const [entity, setEntity] = useState<TrashEntity | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const entityOptions = useMemo(() => {
    const present = new Set(items.map((i) => i.entity));
    return (Object.keys(TRASH_ENTITY_LABELS) as TrashEntity[])
      .filter((e) => present.has(e))
      .map((e) => ({ value: e, label: TRASH_ENTITY_LABELS[e] }));
  }, [items]);
  const shown = entity ? items.filter((i) => i.entity === entity) : items;

  const restore = async (item: TrashItem) => {
    setRestoring(item.group_id);
    try {
      await restoreMut.mutateAsync(item.group_id);
      toast.success('Przywrócono', { description: item.title ?? TRASH_ENTITY_LABELS[item.entity] });
    } catch (err) {
      toast.error('Nie udało się przywrócić', { description: errorMessage(err) });
    } finally {
      setRestoring(null);
    }
  };

  const confirmAction = async () => {
    if (!confirm) return;
    try {
      if (confirm.kind === 'purge') {
        await purgeMut.mutateAsync(confirm.item.group_id);
        toast.success('Usunięto trwale');
      } else {
        const n = await emptyMut.mutateAsync();
        toast.success(`Kosz opróżniony (${n})`);
      }
      setConfirm(null);
    } catch (err) {
      toast.error('Nie udało się usunąć', { description: errorMessage(err) });
    }
  };
  const confirmPending = purgeMut.isPending || emptyMut.isPending;

  return (
    <Page>
      <PageHeader
        icon={Trash2}
        title="Kosz"
        description={
          admin
            ? 'Usunięte rekordy wszystkich osób. Po 7 dniach znikają trwale razem z plikami.'
            : 'Rekordy usunięte przez Ciebie. Po 7 dniach znikają trwale razem z plikami.'
        }
        actions={
          admin && items.length > 0 ? (
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirm({ kind: 'empty' })}
            >
              <Trash2 />
              Opróżnij kosz
            </Button>
          ) : undefined
        }
        toolbar={
          entityOptions.length > 1 ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <FilterChip
                label="Rodzaj"
                value={entity}
                options={entityOptions}
                onChange={(v) => setEntity(v as TrashEntity | null)}
              />
              <span className="text-xs text-muted-foreground" aria-live="polite">
                W koszu: {shown.length}
              </span>
            </div>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm" aria-busy="true">
          <div className="divide-y">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex min-h-16 items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ) : isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Nie udało się wczytać kosza.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Spróbuj ponownie
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Trash2 className="h-5 w-5" />
          </div>
          <p className="text-sm text-muted-foreground">Kosz jest pusty.</p>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
          {shown.map((item) => {
            const extras = extrasLabel(item);
            return (
              <li
                key={item.group_id}
                className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 @md:flex-nowrap"
              >
                <div className="min-w-0 flex-1 basis-60 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {TRASH_ENTITY_LABELS[item.entity]}
                    </span>
                    <span className="min-w-0 truncate text-sm font-medium" title={item.title ?? undefined}>
                      {item.title || '(bez nazwy)'}
                    </span>
                  </div>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {item.context && <span className="min-w-0 truncate">{item.context}</span>}
                    <span>
                      Usunięte {format(new Date(item.deleted_at), 'd MMM, HH:mm', { locale: pl })}
                      {item.deleted_by_name ? ` przez ${item.deleted_by_name}` : item.deleted_by ? '' : ' (system/MCP)'}
                    </span>
                    <span>· {daysLeftLabel(item.purge_after)}</span>
                    {extras && (
                      <span className="inline-flex items-center gap-1">
                        · <Paperclip className="h-3 w-3" aria-hidden /> {extras}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1 @max-md:w-full @max-md:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="max-md:h-11"
                    disabled={restoring !== null}
                    onClick={() => void restore(item)}
                  >
                    {restoring === item.group_id ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    Przywróć
                  </Button>
                  {admin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive max-md:h-11"
                      onClick={() => setConfirm({ kind: 'purge', item })}
                    >
                      <X />
                      Usuń trwale
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && !confirmPending && setConfirm(null)}>
        <DialogContent className="gap-5 sm:max-w-md">
          <DialogHeader className="gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <Trash2 className="h-5 w-5" />
            </div>
            <DialogTitle>{confirm?.kind === 'empty' ? 'Opróżnić kosz?' : 'Usunąć trwale?'}</DialogTitle>
            <DialogDescription>
              {confirm?.kind === 'empty'
                ? `Wszystkie pozycje kosza (${items.length}) zostaną usunięte trwale razem z plikami. Tej operacji nie można cofnąć.`
                : confirm?.kind === 'purge'
                  ? `„${confirm.item.title || TRASH_ENTITY_LABELS[confirm.item.entity]}” zostanie usunięte trwale razem z powiązanymi rekordami i plikami. Tej operacji nie można cofnąć.`
                  : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={confirmPending}>
              Anuluj
            </Button>
            <Button variant="destructive" onClick={() => void confirmAction()} disabled={confirmPending}>
              {confirmPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirm?.kind === 'empty' ? 'Opróżnij kosz' : 'Usuń trwale'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

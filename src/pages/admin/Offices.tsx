import { useState } from 'react';
import { Building2, MoreHorizontal, Pencil, Plus, Star } from 'lucide-react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Page, PageHeader } from '@/components/layout/Page';
import {
  EmptyState,
  HOVER_REVEAL,
  LIST_PANEL,
  LIST_ROW,
  ListSkeleton,
  StatusPill,
} from '@/components/admin/AdminUi';
import { OfficeFormDialog } from '@/components/admin/OfficeFormDialog';

import { useCreateOffice, useOffices, useUpdateOffice } from '@/hooks/useOffices';
import { cn } from '@/lib/utils';
import { plural } from '@/components/public/publicFormat';
import type { Office } from '@/integrations/supabase/types';

export default function AdminOffices() {
  const { data: offices, isLoading } = useOffices();
  const createOffice = useCreateOffice();
  const updateOffice = useUpdateOffice();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Office | null>(null);

  const setMain = async (o: Office) => {
    try {
      await updateOffice.mutateAsync({ id: o.id, is_main: true });
      toast.success('Ustawiono jako biuro główne');
    } catch (err) {
      toast.error('Błąd', { description: errorMessage(err) });
    }
  };

  const toggleActive = async (o: Office) => {
    try {
      await updateOffice.mutateAsync({ id: o.id, is_active: !o.is_active });
      toast.success(o.is_active ? 'Biuro deaktywowane' : 'Biuro aktywowane');
    } catch (err) {
      toast.error('Błąd', { description: errorMessage(err) });
    }
  };

  return (
    <Page narrow>
      <PageHeader
        icon={Building2}
        title="Biura"
        description="Zarządzaj biurami poselskimi. Pracownicy i Asystenci są przypisani do konkretnego biura."
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus />
                Dodaj biuro
              </Button>
            </DialogTrigger>
            <OfficeFormDialog
              mode="create"
              submitting={createOffice.isPending}
              onSubmit={async (values) => {
                try {
                  await createOffice.mutateAsync({
                    name: values.name,
                    city: values.city,
                    address: values.address || null,
                    phone: values.phone || null,
                    email: values.email || null,
                    is_main: values.is_main ?? false,
                  });
                  toast.success('Biuro utworzone');
                  setCreateOpen(false);
                } catch (err) {
                  toast.error('Nie udało się utworzyć biura', {
                    description: errorMessage(err),
                  });
                }
              }}
              onCancel={() => setCreateOpen(false)}
            />
          </Dialog>
        }
      />

      <div className="space-y-2">
        <p className="px-1 text-xs font-medium text-muted-foreground">
          {isLoading ? 'Wczytywanie...' : `${offices?.length ?? 0} ${plural(offices?.length ?? 0, 'biuro', 'biura', 'biur')}`}
        </p>
        <div className={LIST_PANEL}>
          {isLoading && <ListSkeleton rows={3} avatar />}

          {offices?.map((o) => (
            <div key={o.id} className={cn(LIST_ROW, '@max-md:items-start @max-md:gap-2.5', !o.is_active && 'opacity-60')}>
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  o.is_main ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-primary/10 text-primary',
                )}
              >
                {o.is_main ? <Star className="h-4 w-4 fill-current" /> : <Building2 className="h-4 w-4" />}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-tight">{o.name}</p>
                <p className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span className="min-w-0 max-w-full truncate">
                    {o.city}
                    {o.address ? ` - ${o.address}` : ''}
                  </span>
                  {(o.phone || o.email) && (
                    <span className="min-w-0 max-w-full truncate">
                      {[o.phone, o.email].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground/80 @max-md:hidden">
                  Utworzone: {format(new Date(o.created_at), 'd MMM yyyy', { locale: pl })}
                </p>
                <OfficePills office={o} className="mt-1.5 @md:hidden" />
              </div>

              <OfficePills office={o} className="hidden shrink-0 justify-end @md:flex" />

              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('hidden h-8 w-8 md:inline-flex', HOVER_REVEAL)}
                  onClick={() => setEditing(o)}
                  title="Edytuj"
                  aria-label="Edytuj"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-10 w-10 md:h-8 md:w-8" aria-label="Opcje">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => setEditing(o)}>Edytuj</DropdownMenuItem>
                    {!o.is_main && (
                      <DropdownMenuItem onClick={() => setMain(o)}>Ustaw jako główne</DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => toggleActive(o)}>
                      {o.is_active ? 'Deaktywuj' : 'Aktywuj'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}

          {!isLoading && (offices?.length ?? 0) === 0 && (
            <EmptyState
              icon={Building2}
              title="Brak biur. Dodaj pierwsze biuro."
              action={
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus />
                  Dodaj biuro
                </Button>
              }
            />
          )}
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        {editing && (
          <OfficeFormDialog
            mode="edit"
            initial={editing}
            submitting={updateOffice.isPending}
            onSubmit={async (values) => {
              try {
                await updateOffice.mutateAsync({
                  id: editing.id,
                  name: values.name,
                  city: values.city,
                  address: values.address || null,
                  phone: values.phone || null,
                  email: values.email || null,
                  is_main: values.is_main ?? false,
                });
                toast.success('Biuro zaktualizowane');
                setEditing(null);
              } catch (err) {
                toast.error('Nie udało się zaktualizować biura', {
                  description: errorMessage(err),
                });
              }
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>
    </Page>
  );
}

function OfficePills({ office: o, className }: { office: Office; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {o.is_main && <StatusPill tone="primary" dot={false}>Główne</StatusPill>}
      <StatusPill tone={o.is_active ? 'success' : 'neutral'}>
        {o.is_active ? 'Aktywne' : 'Nieaktywne'}
      </StatusPill>
    </div>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Nieznany błąd';
}

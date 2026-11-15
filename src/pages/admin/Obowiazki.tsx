import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Page, PageHeader } from '@/components/layout/Page';
import { ErrorNotice, LIST_PANEL, LIST_ROW, ListSkeleton, StatusPill } from '@/components/admin/AdminUi';
import { ModuleOwnersDialog } from '@/components/admin/ModuleOwnersDialog';
import { OwnerList } from '@/components/common/ModuleOwners';
import { useModuleOwners } from '@/hooks/useModuleOwners';
import { errorMessage } from '@/lib/errors';
import { OWNED_MODULES, type OwnedModuleInfo } from '@/lib/moduleOwners';

export default function AdminObowiazki() {
  const ownersQ = useModuleOwners();
  const [editing, setEditing] = useState<OwnedModuleInfo | null>(null);

  const owners = ownersQ.data ?? [];
  const ownersOf = (module: string) => owners.filter((o) => o.module === module);

  return (
    <Page narrow>
      <PageHeader
        icon={ClipboardList}
        title="Podział obowiązków"
        description="Każdy moduł ma jedną lub dwie osoby odpowiedzialne. Kontakty nie mają opiekuna, sprawy wyborców przypisuje się pojedynczo."
      />

      {ownersQ.error ? (
        <ErrorNotice title="Nie udało się wczytać podziału obowiązków" message={errorMessage(ownersQ.error)} />
      ) : (
        <div className={LIST_PANEL}>
          {ownersQ.isLoading && <ListSkeleton rows={OWNED_MODULES.length} avatar />}

          {!ownersQ.isLoading &&
            OWNED_MODULES.map((m) => {
              const moduleOwners = ownersOf(m.module);
              return (
                <div key={m.module} className={LIST_ROW}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <m.Icon className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <Link to={m.to} className="text-sm font-medium leading-tight hover:underline">
                      {m.label}
                    </Link>
                    {moduleOwners.length > 0 ? (
                      <OwnerList owners={moduleOwners} className="mt-1 text-xs" />
                    ) : (
                      <div className="mt-1">
                        <StatusPill tone="warning">Brak osoby odpowiedzialnej</StatusPill>
                      </div>
                    )}
                  </div>

                  <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Zmień
                  </Button>
                </div>
              );
            })}
        </div>
      )}

      <ModuleOwnersDialog
        key={editing?.module ?? 'closed'}
        module={editing}
        owners={editing ? ownersOf(editing.module) : []}
        onClose={() => setEditing(null)}
      />
    </Page>
  );
}

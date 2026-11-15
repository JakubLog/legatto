import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Map as MapIcon, Plus, Upload, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Page, PageHeader } from '@/components/layout/Page';
import { ModuleOwners } from '@/components/common/ModuleOwners';
import { useAuth } from '@/contexts/AuthContext';
import { canWrite } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { ContactsFilters } from '@/components/contacts/ContactsFilters';
import { ContactsList } from '@/components/contacts/ContactsList';
import { ContactDetailsDialog } from '@/components/contacts/ContactDetailsDialog';
import { ContactFormDialog } from '@/components/contacts/ContactFormDialog';
import { DeleteContactDialog } from '@/components/contacts/DeleteContactDialog';
import { ImportContactsDialog } from '@/components/contacts/ImportContactsDialog';
import { ContactsViewTabs, type ContactsView } from '@/components/contacts/ContactsViewTabs';
import { EMPTY_CONTACT_FILTERS, hasActiveContactFilters } from '@/components/contacts/filters';
import { Pagination } from '@/components/common/Pagination';
import { KampanieView } from '@/components/campaigns/KampanieView';
import { useContact, useContacts, CONTACTS_PAGE_SIZE, type ContactsFilters as Filters } from '@/hooks/useContacts';
import { useOpenParam } from '@/hooks/useOpenParam';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { ContactWithRelations } from '@/integrations/supabase/types';

const DistrictSvg = lazy(() =>
  import('@/components/contacts/DistrictSvg').then((m) => ({ default: m.DistrictSvg })),
);

/** Renderuje nagłówek strony z akcjami danego widoku. */
type HeaderRenderer = (actions?: ReactNode) => ReactNode;

export default function Kontakty() {
  const { profile } = useAuth();
  const writer = canWrite(profile?.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const widokParam = searchParams.get('widok');
  const widok: ContactsView = widokParam === 'kampanie' ? 'kampanie' : 'baza';

  const setWidok = (next: ContactsView) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === 'baza') params.delete('widok');
        else params.set('widok', next);
        // Deep-link do kontaktu dotyczy tylko bazy - nie przenosimy go między widokami.
        params.delete('open');
        return params;
      },
      { replace: true },
    );
  };

  const renderHeader: HeaderRenderer = (actions) => (
    <PageHeader
      icon={Users}
      title="Centrum kontaktowe"
      titleAddon={widok === 'kampanie' ? <ModuleOwners module="newsletter" /> : undefined}
      description={
        widok === 'baza'
          ? 'Baza wyborców, samorządowców, sołtysów i dziennikarzy w okręgu.'
          : 'Kampanie e-mail wysłane przez GetResponse.'
      }
      actions={actions}
      toolbar={<ContactsViewTabs value={widok} onChange={setWidok} />}
    />
  );

  return (
    <Page>
      {widok === 'baza' ? (
        <BazaView writer={writer} renderHeader={renderHeader} />
      ) : (
        <KampanieView renderHeader={renderHeader} />
      )}
    </Page>
  );
}

function BazaView({ writer, renderHeader }: { writer: boolean; renderHeader: HeaderRenderer }) {
  const isMobile = useIsMobile();
  const [filters, setFilters] = useState<Filters>(EMPTY_CONTACT_FILTERS);
  const [page, setPage] = useState(0);
  const [showMap, setShowMap] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<ContactWithRelations | null>(null);
  const [deleting, setDeleting] = useState<ContactWithRelations | null>(null);
  const [details, setDetails] = useState<ContactWithRelations | null>(null);

  const { data, isLoading } = useContacts(filters, page);
  const contacts = data?.contacts ?? [];
  const total = data?.total ?? 0;

  // Deep-link `?open=<id>` (wyszukiwarka globalna): najpierw wczytana strona, potem pobranie po id.
  const [openId, clearOpen] = useOpenParam();
  const listMatch = openId ? (contacts.find((c) => c.id === openId) ?? null) : null;
  const byIdQ = useContact(openId && !isLoading && !listMatch ? openId : null);
  const linked = listMatch ?? byIdQ.data ?? null;
  const linkMissing = Boolean(openId) && (byIdQ.isError || (byIdQ.isSuccess && byIdQ.data === null));

  useEffect(() => {
    if (!linkMissing) return;
    toast.error('Nie znaleziono kontaktu', {
      description: 'Rekord nie istnieje lub nie masz do niego dostępu.',
    });
    clearOpen();
  }, [linkMissing, clearOpen]);

  const closeDetails = () => {
    setDetails(null);
    if (openId) clearOpen();
  };

  const handleFiltersChange = (next: Filters) => {
    setFilters(next);
    setPage(0);
  };

  const handleAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const handleEdit = (c: ContactWithRelations) => {
    setEditing(c);
    setFormOpen(true);
  };

  return (
    <>
      {renderHeader(
        writer && (
          <>
            {/* Import CSV tylko na komputerze. */}
            <Button variant="outline" className="max-md:hidden" onClick={() => setImportOpen(true)}>
              <Upload />
              Importuj CSV
            </Button>
            <Button onClick={handleAdd}>
              <Plus />
              Dodaj kontakt
            </Button>
          </>
        ),
      )}

      <div className="flex flex-col gap-3 md:gap-2 @lg:flex-row @lg:items-center">
        <ContactsFilters value={filters} onChange={handleFiltersChange} />
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 @lg:justify-end">
          <div className="text-xs text-muted-foreground" aria-live="polite">
            {isLoading ? <Skeleton className="h-3 w-20" /> : `Znaleziono: ${total}`}
          </div>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={showMap}
            onClick={() => setShowMap((v) => !v)}
            className={cn('rounded-full', showMap && 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}
          >
            <MapIcon />
            {showMap ? 'Ukryj mapę' : 'Pokaż mapę'}
          </Button>
        </div>
      </div>

      {showMap && (
        <Suspense fallback={<Skeleton className="h-80 w-full rounded-xl" />}>
          <DistrictSvg
            selectedPowiatId={filters.powiatId ?? null}
            selectedGminaId={filters.gminaId ?? null}
            onChange={({ powiatId, gminaId }) =>
              handleFiltersChange({ ...filters, powiatId, gminaId })
            }
          />
        </Suspense>
      )}

      <ContactsList
        contacts={contacts}
        total={total}
        filters={filters}
        isLoading={isLoading}
        filtered={hasActiveContactFilters(filters)}
        onOpen={setDetails}
        onAdd={writer ? handleAdd : undefined}
        onEdit={handleEdit}
        onDelete={setDeleting}
      />

      <Pagination
        page={page}
        total={total}
        pageSize={CONTACTS_PAGE_SIZE}
        onChange={setPage}
      />

      <ContactDetailsDialog
        contact={details ?? linked}
        onClose={closeDetails}
        onEdit={handleEdit}
        onDelete={setDeleting}
      />
      <ContactFormDialog open={formOpen} onOpenChange={setFormOpen} contact={editing} />
      <DeleteContactDialog contact={deleting} onClose={() => setDeleting(null)} />
      {!isMobile && <ImportContactsDialog open={importOpen} onOpenChange={setImportOpen} />}
    </>
  );
}

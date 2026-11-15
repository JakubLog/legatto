import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FilePlus2, FileSignature, Search, Send, Signature, Undo2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/layout/Page';
import { BulkBar } from '@/components/signing/BulkBar';
import { MarkSentDialog } from '@/components/signing/MarkSentDialog';
import { ReturnDialog } from '@/components/signing/ReturnDialog';
import { SignedUploadDialog } from '@/components/signing/SignedUploadDialog';
import { SigningList } from '@/components/signing/SigningList';
import { UploadDocumentDialog } from '@/components/signing/UploadDocumentDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useMpForms } from '@/hooks/useMpForms';
import { useSigningCounts, useSigningDocuments } from '@/hooks/useSigningDocuments';
import { useAssignableUsers } from '@/hooks/useUsers';
import { canWrite, isAdmin } from '@/lib/permissions';
import { SIGNING_VIEWS, parseSigningView, type SigningDocument, type SigningView } from '@/lib/signing';
import { cn } from '@/lib/utils';

interface AttentionItem {
  key: string;
  label: string;
  count: number;
  icon: LucideIcon;
  view: SigningView;
  mine?: boolean;
}

export default function Dokumenty() {
  const { profile, user } = useAuth();
  const role = profile?.role;
  const admin = isAdmin(role);
  const writer = canWrite(role);
  const actor = { userId: user?.id, role };
  const mp = useMpForms();
  const navigate = useNavigate();

  const [params, setParams] = useSearchParams();
  const view = parseSigningView(params.get('widok'));
  const mine = params.get('moje') === '1';
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const listQ = useSigningDocuments({ view, search, mine });
  const countsQ = useSigningCounts(mine);
  const { data: users = [] } = useAssignableUsers();
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.full_name ?? null;

  const documents = useMemo(() => listQ.data ?? [], [listQ.data]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // Zaznaczenie dotyczy bieżącego widoku; po zmianie filtrów zostają tylko widoczne dokumenty.
  const selected = documents.filter((d) => selectedIds.has(d.id));

  const [uploadOpen, setUploadOpen] = useState(false);
  const [signedOpen, setSignedOpen] = useState(false);
  const [markDocs, setMarkDocs] = useState<SigningDocument[]>([]);
  const [returnDocs, setReturnDocs] = useState<SigningDocument[]>([]);

  const setFilter = (next: { view?: SigningView; mine?: boolean }) => {
    const p = new URLSearchParams(params);
    const v = next.view ?? view;
    const m = next.mine ?? mine;
    p.set('widok', v);
    if (m) p.set('moje', '1');
    else p.delete('moje');
    setParams(p, { replace: true });
    setSelectedIds(new Set());
  };

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = (ids: string[], select: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const clearSelection = () => setSelectedIds(new Set());

  const counts = countsQ.data;
  const attention: AttentionItem[] = [
    ...(admin && counts && counts.toSign > 0
      ? [{ key: 'sign', label: 'Do podpisu', count: counts.toSign, icon: Signature, view: 'do-podpisu' as const }]
      : []),
    ...(admin && counts && counts.readyToSend > 0
      ? [{ key: 'send', label: 'Gotowe do wysyłki', count: counts.readyToSend, icon: Send, view: 'podpisane' as const }]
      : []),
    ...(writer && !admin && counts && counts.myReturned > 0
      ? [{ key: 'returned', label: 'Do poprawy', count: counts.myReturned, icon: Undo2, view: 'do-podpisu' as const, mine: true }]
      : []),
  ];

  const filtered = search.length >= 2 || mine || view !== 'wszystkie';
  const emptyState = (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <FileSignature className="h-5 w-5" />
      </div>
      <p className="max-w-md text-sm text-muted-foreground">
        {counts && counts.byView.wszystkie === 0
          ? writer
            ? `Brak dokumentów. Dodaj pismo w PDF lub DOCX - trafi do ${mp.genitive} do podpisu.`
            : 'Brak dokumentów.'
          : 'Brak dokumentów w wybranym widoku.'}
      </p>
      {counts && counts.byView.wszystkie === 0 && writer ? (
        <Button size="sm" onClick={() => setUploadOpen(true)}>
          <FilePlus2 />
          Dodaj dokumenty
        </Button>
      ) : filtered ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSearchInput('');
            setFilter({ view: 'wszystkie', mine: false });
          }}
        >
          Pokaż wszystkie
        </Button>
      ) : null}
    </div>
  );

  return (
    <Page>
      <PageHeader
        icon={Signature}
        title="Dokumenty do podpisu"
        description={
          <span className="@max-md:hidden">
            Biuro wgrywa pisma, {mp.nominative} pobiera je paczkami ZIP, podpisuje poza portalem i wgrywa podpisane;
            potem oznaczenie jako wysłane.
          </span>
        }
        actions={
          <>
            {admin && (
              <Button variant="outline" size="sm" onClick={() => setSignedOpen(true)}>
                <FileSignature />
                Wgraj podpisane
              </Button>
            )}
            {writer && (
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <FilePlus2 />
                Dodaj dokumenty
              </Button>
            )}
          </>
        }
        toolbar={
          <>
            <div className="relative w-full @md:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Szukaj dokumentów"
                placeholder="Szukaj: tytuł, kod, adresat"
                className="pl-8"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm max-md:min-h-10 @md:ml-auto">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input accent-primary max-md:h-5 max-md:w-5"
                checked={mine}
                onChange={(e) => setFilter({ mine: e.target.checked })}
              />
              Tylko moje
            </label>
            {!listQ.isLoading && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-live="polite">
                {documents.length}
              </span>
            )}
          </>
        }
      />

      {attention.length > 0 && (
        <div role="group" aria-label="Wymaga działania" className="grid gap-2 @sm:flex @sm:flex-wrap">
          {attention.map(({ key, label, count, icon: Icon, view: target, mine: targetMine }) => {
            const active = view === target && (targetMine === undefined || mine === targetMine);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                aria-label={`${label}: ${count}`}
                onClick={() => setFilter({ view: target, mine: targetMine ?? mine })}
                className={cn(
                  'flex min-h-12 items-center gap-3 rounded-xl border bg-card px-3 text-left text-sm shadow-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-10',
                  active ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/60',
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 font-medium">{label}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div
        role="group"
        aria-label="Widok"
        className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 md:gap-1 @max-md:pr-8 @max-md:[mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)]"
      >
        {SIGNING_VIEWS.map((v) => {
          const active = view === v.value;
          return (
            <button
              key={v.value}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter({ view: v.value })}
              className={cn(
                'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8',
                active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {v.label}
              {counts && <span className="tabular-nums text-xs opacity-70">{counts.byView[v.value]}</span>}
            </button>
          );
        })}
      </div>

      {listQ.isError ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Nie udało się wczytać dokumentów.
        </p>
      ) : (
        <SigningList
          documents={documents}
          isLoading={listQ.isLoading}
          selectable={admin}
          selectedIds={selectedIds}
          onToggle={toggle}
          onToggleAll={toggleAll}
          authorName={nameOf}
          emptyState={emptyState}
        />
      )}

      {admin && selected.length > 0 && (
        <BulkBar
          selected={selected}
          actor={actor}
          onMarkSent={setMarkDocs}
          onReturn={setReturnDocs}
          onClear={clearSelection}
        />
      )}

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onCreated={(ids) => {
          if (ids.length === 1) navigate(`/biuro/dokumenty/${ids[0]}`);
        }}
      />
      {admin && <SignedUploadDialog open={signedOpen} onOpenChange={setSignedOpen} />}
      <MarkSentDialog documents={markDocs} onClose={() => setMarkDocs([])} onDone={clearSelection} />
      <ReturnDialog documents={returnDocs} onClose={() => setReturnDocs([])} onDone={clearSelection} />
    </Page>
  );
}

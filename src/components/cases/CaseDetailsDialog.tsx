import { useState } from 'react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { Globe, Mail, Pencil, Phone, Plus, Trash2, User as UserIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { useCasePatch, type CaseInput } from '@/hooks/useCases';
import { useMpForms } from '@/hooks/useMpForms';
import { isCaseResolved } from '@/lib/cases';
import { mailtoHref } from '@/lib/mailto';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { canWrite, isAdmin } from '@/lib/permissions';
import type { CaseWithRelations } from '@/integrations/supabase/types';
import { CaseAttachments } from './CaseAttachments';
import { CaseProperties } from './CaseProperties';
import { CaseDescription } from './CaseDescription';
import { CaseHistoryPanel } from './CaseHistoryPanel';
import { CaseInlineEditor } from './CaseInlineEditor';
import { CaseReporterEditor } from './CaseReporterEditor';
import { ReassignCaseDialog } from './ReassignCaseDialog';
import { ADD_TILE, EDITABLE_TILE, activateOnKey, selectingText } from './inlineEdit';

interface Props {
  case_: CaseWithRelations | null;
  onClose: () => void;
  onDelete: (c: CaseWithRelations) => void;
}

type Tab = 'details' | 'history';
type Editing = 'title' | 'reporter' | 'notes' | null;

function formatDateTime(value: string | null) {
  if (!value) return null;
  return format(new Date(value), 'd MMM yyyy, HH:mm', { locale: pl });
}

/**
 * Podgląd sprawy, edytowany w miejscu (bez osobnego trybu edycji): osoba z prawem zapisu klika
 * tytuł, wartość właściwości, opis, osobę zgłaszającą albo notatki i zapisuje od razu.
 * Od lg: dwie kolumny - szczegóły (własne przewijanie) i panel „Historia” (własne przewijanie,
 * pole komentarza na dole). Niżej (tablet, arkusz na telefonie) zakładki „Szczegóły / Historia”:
 * w niskim arkuszu historia pod szczegółami wymagałaby przewinięcia całej sprawy.
 */
export function CaseDetailsDialog({ case_, onClose, onDelete }: Props) {
  const { profile } = useAuth();
  const writer = canWrite(profile?.role);
  const admin = isAdmin(profile?.role);

  const [reassigning, setReassigning] = useState(false);
  const [tab, setTab] = useState<Tab>('details');
  const [editing, setEditing] = useState<Editing>(null);
  // Ostatnia pokazana sprawa zostaje w oknie podczas zamykania, żeby animacja wyjścia
  // (fade + zoom, na telefonie zjazd arkusza) miała treść zamiast pustego okna.
  // Każde otwarcie (także tej samej sprawy) zaczyna od zakładki „Szczegóły”, bez otwartej edycji.
  const [shown, setShown] = useState(case_);
  const [wasOpen, setWasOpen] = useState(Boolean(case_));
  if (case_ && case_ !== shown) {
    if (case_.id !== shown?.id) setEditing(null);
    setShown(case_);
  }
  if (Boolean(case_) !== wasOpen) {
    setWasOpen(Boolean(case_));
    if (case_) {
      setTab('details');
      setEditing(null);
    }
  }

  const c = case_ ?? shown;
  const { save } = useCasePatch(c?.id ?? '');
  const mp = useMpForms();
  if (!c) return null;

  const resolved = isCaseResolved(c.status);
  const hasReporter = Boolean(c.contact || c.reporter_name || c.reporter_phone || c.reporter_email);
  const saveAndClose = async (patch: Partial<CaseInput>) => {
    const ok = await save(patch);
    if (ok) setEditing(null);
    return ok;
  };

  return (
    <Dialog open={Boolean(case_)} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-h-[92vh] gap-5 sm:max-w-2xl lg:max-h-[min(90vh,60rem)] lg:min-h-[min(36rem,90vh)] lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:grid-rows-[minmax(0,1fr)] lg:gap-0 lg:overflow-hidden lg:p-0"
        onEscapeKeyDown={(e) => {
          // Esc przy otwartej liście wzmianek albo w polu edycji w miejscu zamyka tylko je.
          if ((e.target as HTMLElement | null)?.closest?.('[data-mention-open="true"], [data-inline-edit]')) e.preventDefault();
        }}
      >
        <div className="flex min-w-0 flex-col gap-5 lg:min-h-0 lg:overflow-y-auto lg:p-6">
          <DialogHeader className="gap-1">
            {editing === 'title' ? (
              <>
                <DialogTitle className="sr-only">{c.title}</DialogTitle>
                <TitleEditor
                  initial={c.title}
                  onCancel={() => setEditing(null)}
                  onSave={(title) => saveAndClose({ title })}
                />
              </>
            ) : (
              <DialogTitle className="text-xl font-semibold leading-snug">
                {writer ? (
                  <button
                    type="button"
                    className={cn(EDITABLE_TILE, '-mx-2 w-[calc(100%+1rem)] px-2 py-0.5 text-left lg:max-w-[calc(100%+1rem)]')}
                    onClick={() => !selectingText() && setEditing('title')}
                    title="Kliknij, aby zmienić tytuł"
                  >
                    {c.title}
                  </button>
                ) : (
                  c.title
                )}
              </DialogTitle>
            )}
            <DialogDescription className="text-xs">
              Utworzona {formatDateTime(c.created_at)}
              {c.creator ? ` przez ${c.creator.full_name}` : ''}
            </DialogDescription>
          </DialogHeader>

          <div role="tablist" aria-label="Widok sprawy" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 lg:hidden">
            {(['details', 'history'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`case-tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`case-panel-${t}`}
                onClick={() => setTab(t)}
                className={cn(
                  'min-h-9 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 max-md:min-h-11',
                  tab === t ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t === 'details' ? 'Szczegóły' : 'Historia'}
              </button>
            ))}
          </div>

          <div
            id="case-panel-details"
            role="tabpanel"
            aria-labelledby="case-tab-details"
            className={cn('flex flex-col gap-5', tab !== 'details' && 'max-lg:hidden')}
          >
            <CaseProperties case_={c} onReassign={writer ? () => setReassigning(true) : undefined} />

            <CaseDescription
              caseId={c.id}
              text={c.description}
              onSave={writer ? (value) => save({ description: value || null }) : undefined}
            />

            {(hasReporter || writer) && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Osoba zgłaszająca</h3>
                {editing === 'reporter' ? (
                  <CaseReporterEditor case_={c} onSave={save} onClose={() => setEditing(null)} />
                ) : hasReporter ? (
                  <ReporterCard case_={c} onEdit={writer ? () => setEditing('reporter') : undefined} />
                ) : (
                  <button type="button" className={ADD_TILE} onClick={() => setEditing('reporter')}>
                    <Plus />
                    Dodaj osobę zgłaszającą
                  </button>
                )}
              </section>
            )}

            {c.source === 'public_form' && (
              <div className="flex gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
                <Globe className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Zgłoszenie z formularza publicznego.</span>{' '}
                  Zgłaszający{' '}
                  {c.consent_newsletter ? <span className="font-medium text-foreground">wyraził zgodę</span> : 'nie wyraził zgody'}{' '}
                  na newsletter/SMS o działaniach {mp.genitive} oraz{' '}
                  {c.consent_contacts_db ? <span className="font-medium text-foreground">wyraził zgodę</span> : 'nie wyraził zgody'}{' '}
                  na zapisanie do bazy kontaktów jako wyborca.
                </p>
              </div>
            )}

            {resolved && (c.resolution_notes || writer) && (
              <section className="space-y-1.5">
                <h3 className="text-sm font-medium">Notatki rozwiązania</h3>
                {editing === 'notes' ? (
                  <CaseInlineEditor
                    initial={c.resolution_notes ?? ''}
                    label="Notatki rozwiązania"
                    placeholder="Opisz krótko jak sprawa została załatwiona / odrzucona"
                    onCancel={() => setEditing(null)}
                    onSave={(value) => saveAndClose({ resolution_notes: value || null })}
                  />
                ) : c.resolution_notes ? (
                  <p
                    className={cn('whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm', writer && EDITABLE_TILE)}
                    {...(writer && {
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': 'Edytuj notatki rozwiązania',
                      onClick: () => !selectingText() && setEditing('notes'),
                      onKeyDown: (e: React.KeyboardEvent) => activateOnKey(e, () => setEditing('notes')),
                    })}
                  >
                    {c.resolution_notes}
                  </p>
                ) : (
                  <button type="button" className={ADD_TILE} onClick={() => setEditing('notes')}>
                    <Plus />
                    Dodaj notatki rozwiązania
                  </button>
                )}
              </section>
            )}

            <Separator />

            <CaseAttachments caseId={c.id} />

            {c.updated_at !== c.created_at && (
              <p className="text-xs text-muted-foreground">
                Ostatnia zmiana: {formatDateTime(c.updated_at)}
              </p>
            )}
          </div>

          {admin && (
            <DialogFooter className={cn('lg:mt-auto', tab !== 'details' && 'max-lg:hidden')}>
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto"
                onClick={() => onDelete(c)}
              >
                <Trash2 />
                Usuń
              </Button>
            </DialogFooter>
          )}
        </div>

        <CaseHistoryPanel
          caseId={c.id}
          panelId="case-panel-history"
          className={cn('lg:border-l lg:bg-muted/20', tab !== 'history' && 'max-lg:hidden')}
        />
        <ReassignCaseDialog case_={reassigning ? c : null} onClose={() => setReassigning(false)} />
      </DialogContent>
    </Dialog>
  );
}

interface TitleEditorProps {
  initial: string;
  onSave: (title: string) => Promise<boolean>;
  onCancel: () => void;
}

/** Tytuł: Enter albo wyjście z pola zapisuje, Esc anuluje; min. 2 znaki jak w formularzu. */
function TitleEditor({ initial, onSave, onCancel }: TitleEditorProps) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const tooShort = value.trim().length < 2;

  const submit = async () => {
    if (saving || tooShort) return;
    if (value.trim() === initial) {
      onCancel();
      return;
    }
    setSaving(true);
    await onSave(value.trim());
    setSaving(false);
  };

  return (
    <div data-inline-edit="" className="space-y-1">
      <Input
        autoFocus
        aria-label="Tytuł sprawy"
        value={value}
        disabled={saving}
        aria-invalid={tooShort || undefined}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => (tooShort ? onCancel() : void submit())}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        className="-mx-2 h-10 w-[calc(100%+1rem)] px-2 text-xl font-semibold max-md:h-11 md:text-xl"
      />
      {tooShort && <p className="text-xs text-destructive">Min. 2 znaki</p>}
    </div>
  );
}

interface ReporterCardProps {
  case_: CaseWithRelations;
  /** Gdy podane - klik w kafelek (poza telefonem i e-mailem) otwiera edycję. */
  onEdit?: () => void;
}

function ReporterCard({ case_: c, onEdit }: ReporterCardProps) {
  const reporterName = c.contact && `${c.contact.first_name} ${c.contact.last_name}`.trim();
  const reporterEmail = c.contact?.email || c.reporter_email;
  const reporterMailto = mailtoHref(reporterEmail);
  const phone = c.contact?.phone ?? c.reporter_phone;

  return (
    <div
      className={cn('flex items-start gap-3 rounded-lg border bg-muted/40 p-3', onEdit && EDITABLE_TILE)}
      onClick={(e) => {
        if (onEdit && !(e.target as HTMLElement).closest('a, button') && !selectingText()) onEdit();
      }}
    >
      <CreatorAvatar name={reporterName || c.reporter_name || '?'} className="h-9 w-9" fallbackClassName="text-xs" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">{reporterName || c.reporter_name || '(bez nazwy)'}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {phone && (
            <a href={`tel:${phone}`} className="inline-flex items-center gap-1 hover:text-foreground">
              <Phone className="h-3 w-3" />
              {phone}
            </a>
          )}
          {reporterEmail && reporterMailto && (
            <a href={reporterMailto} className="inline-flex items-center gap-1 hover:text-foreground">
              <Mail className="h-3 w-3" />
              {reporterEmail}
            </a>
          )}
          {reporterEmail && !reporterMailto && (
            <span className="inline-flex items-center gap-1 break-all">
              <Mail className="h-3 w-3" />
              {reporterEmail}
            </span>
          )}
          {c.contact && (
            <span className="inline-flex items-center gap-1">
              <UserIcon className="h-3 w-3" />Z bazy kontaktów
            </span>
          )}
        </div>
      </div>
      {onEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-my-1 -mr-1 h-8 w-8 shrink-0 text-muted-foreground max-md:h-11 max-md:w-11"
          onClick={onEdit}
          aria-label="Zmień osobę zgłaszającą"
          title="Zmień osobę zgłaszającą"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

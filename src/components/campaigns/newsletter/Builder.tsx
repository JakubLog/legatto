import { useState, type ReactNode } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  GripVertical,
  History,
  PanelBottom,
  PanelTop,
  Plus,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PreviewBlockKey } from '@/lib/newsletter/render';
import { SECTION_KEYS, type NewsletterTemplate, type SectionKey } from '@/lib/newsletter/types';

import { BasicsFields, FooterFields, HeaderFields, SECTION_FIELDS } from './EditorFields';
import { SECTION_META, blockDomId, countErrors } from './sections';

// ============================================================================
// Edytor blokowy: podstawy maila + lista aktywnych sekcji (akordeon) z
// dodawaniem z palety, przeciąganiem, strzałkami i usuwaniem z "Cofnij".
// ============================================================================

type Form = UseFormReturn<NewsletterTemplate>;

interface BuilderProps {
  form: Form;
  active: PreviewBlockKey | null;
  onToggle: (key: PreviewBlockKey) => void;
  onSelect: (key: PreviewBlockKey) => void;
  restoredAt: string | null;
  onDiscardDraft: () => void;
}

export function Builder({ form, active, onToggle, onSelect, restoredAt, onDiscardDraft }: BuilderProps) {
  const sections = useWatch({ control: form.control, name: 'sections' }) ?? [];
  const values = useWatch({ control: form.control }) as NewsletterTemplate;
  const errors = form.formState.errors;
  const [dragKey, setDragKey] = useState<SectionKey | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // Ostatnio usunięta sekcja - pasek "Cofnij" w jej miejscu (toast pod modalem nie przyjmuje kliknięć).
  const [removed, setRemoved] = useState<{ key: SectionKey; index: number } | null>(null);

  const setSections = (next: SectionKey[]) => {
    setRemoved(null);
    form.setValue('sections', next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  };

  const move = (key: SectionKey, to: number) => {
    const from = sections.indexOf(key);
    if (from < 0) return;
    const next = sections.filter((k) => k !== key);
    next.splice(from < to ? to - 1 : to, 0, key);
    setSections(next);
  };

  const remove = (key: SectionKey) => {
    const index = sections.indexOf(key);
    setSections(sections.filter((k) => k !== key));
    setRemoved({ key, index });
  };

  const undoRemove = () => {
    if (!removed) return;
    const next = [...sections];
    next.splice(Math.min(removed.index, next.length), 0, removed.key);
    setSections(next);
    onSelect(removed.key);
  };

  const add = (key: SectionKey) => {
    setSections([...sections, key]);
    onSelect(key);
  };

  const finishDrag = () => {
    setDragKey(null);
    setDropIndex(null);
  };

  const undoBar = removed && (
    <div className="mb-2 flex items-center gap-3 rounded-xl border border-dashed bg-muted/40 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 text-muted-foreground">
        Usunięto „{SECTION_META[removed.key].label}”. Treść zostaje w szkicu.
      </span>
      <Button type="button" variant="outline" size="sm" className="h-7" onClick={undoRemove}>
        <Undo2 /> Cofnij
      </Button>
      <button
        type="button"
        onClick={() => setRemoved(null)}
        aria-label="Ukryj"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <div className="space-y-5 p-5">
      {restoredAt && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <History className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            Wczytano niedokończony newsletter z{' '}
            {new Date(restoredAt).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })}.
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={onDiscardDraft} className="h-7 shrink-0">
            Zacznij od nowa
          </Button>
        </div>
      )}

      <section id={blockDomId('basics')} className="scroll-mt-4 rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">Temat i zajawka</h3>
        <BasicsFields form={form} />
      </section>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h3 className="text-sm font-semibold">Układ maila</h3>
          <span className="text-xs text-muted-foreground">Przeciągnij lub użyj strzałek, aby zmienić kolejność</span>
        </div>

        <BlockCard
          blockKey="header"
          title="Nagłówek"
          summary={values.header?.date_label ?? ''}
          Icon={PanelTop}
          expanded={active === 'header'}
          onToggle={() => onToggle('header')}
          errorCount={countErrors(errors.header)}
        >
          <HeaderFields form={form} />
        </BlockCard>

        <div
          onDragOver={(e) => {
            if (dragKey) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragKey && dropIndex !== null) move(dragKey, dropIndex);
            finishDrag();
          }}
          className="space-y-2"
        >
          {sections.map((key, index) => {
            const meta = SECTION_META[key];
            const Fields = SECTION_FIELDS[key];
            return (
              <div key={key}>
                {removed?.index === index && undoBar}
                {dragKey && dropIndex === index && <DropLine />}
                <BlockCard
                  blockKey={key}
                  title={meta.label}
                  summary={meta.summary(values)}
                  Icon={meta.Icon}
                  expanded={active === key}
                  onToggle={() => onToggle(key)}
                  errorCount={countErrors(errors[key])}
                  dragging={dragKey === key}
                  drag={{
                    onDragStart: (e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', key);
                      setDragKey(key);
                    },
                    onDragEnd: finishDrag,
                    onDragOver: (e) => {
                      if (!dragKey) return;
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setDropIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
                    },
                  }}
                  actions={
                    <>
                      <IconAction label="Przesuń wyżej" Icon={ArrowUp} disabled={index === 0} onClick={() => move(key, index - 1)} />
                      <IconAction
                        label="Przesuń niżej"
                        Icon={ArrowDown}
                        disabled={index === sections.length - 1}
                        onClick={() => move(key, index + 2)}
                      />
                      <IconAction label="Usuń sekcję" Icon={Trash2} destructive onClick={() => remove(key)} />
                    </>
                  }
                >
                  <Fields form={form} />
                </BlockCard>
              </div>
            );
          })}
          {removed && removed.index >= sections.length && undoBar}
          {dragKey && dropIndex === sections.length && <DropLine />}
        </div>

        {errors.sections?.message && (
          <p className="px-1 text-xs text-destructive">{errors.sections.message}</p>
        )}

        <SectionPalette used={sections} onAdd={add} />

        <BlockCard
          blockKey="footer"
          title="Stopka"
          summary={values.footer?.office_name ?? ''}
          Icon={PanelBottom}
          expanded={active === 'footer'}
          onToggle={() => onToggle('footer')}
          errorCount={countErrors(errors.footer)}
        >
          <FooterFields form={form} />
        </BlockCard>
      </div>
    </div>
  );
}

function DropLine() {
  return <div aria-hidden className="mx-2 mb-2 h-0.5 rounded-full bg-primary" />;
}

function IconAction({
  label,
  Icon,
  onClick,
  disabled,
  destructive,
}: {
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors disabled:pointer-events-none disabled:opacity-30',
        destructive ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

interface BlockCardProps {
  blockKey: PreviewBlockKey;
  title: string;
  summary: string;
  Icon: LucideIcon;
  expanded: boolean;
  onToggle: () => void;
  errorCount: number;
  children: ReactNode;
  actions?: ReactNode;
  dragging?: boolean;
  drag?: {
    onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
    onDragEnd: () => void;
    onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  };
}

function BlockCard({
  blockKey,
  title,
  summary,
  Icon,
  expanded,
  onToggle,
  errorCount,
  children,
  actions,
  dragging,
  drag,
}: BlockCardProps) {
  const contentId = `${blockDomId(blockKey)}-content`;
  return (
    <section
      id={blockDomId(blockKey)}
      onDragOver={drag?.onDragOver}
      className={cn(
        'group/block scroll-mt-4 rounded-xl border bg-card shadow-sm transition-[box-shadow,opacity,border-color]',
        expanded && 'border-primary/40 ring-2 ring-primary/15',
        errorCount > 0 && !expanded && 'border-destructive/40',
        dragging && 'opacity-40',
      )}
    >
      <div
        draggable={Boolean(drag)}
        onDragStart={drag?.onDragStart}
        onDragEnd={drag?.onDragEnd}
        className="flex items-center gap-2 py-2 pl-2 pr-2.5"
      >
        {drag ? (
          <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/60 active:cursor-grabbing" aria-hidden />
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              expanded ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary',
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold leading-tight">{title}</span>
            <span className={cn('block truncate text-xs', summary.trim() ? 'text-muted-foreground' : 'italic text-muted-foreground/70')}>
              {summary.trim() || 'Kliknij, aby uzupełnić'}
            </span>
          </span>
        </button>
        {errorCount > 0 && (
          <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
            {errorCount} do uzupełnienia
          </span>
        )}
        {actions && (
          <div className="flex shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within/block:opacity-100 sm:group-hover/block:opacity-100">
            {actions}
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>
      {expanded && (
        <div id={contentId} className="border-t px-4 pb-4 pt-3">
          {children}
        </div>
      )}
    </section>
  );
}

function SectionPalette({ used, onAdd }: { used: SectionKey[]; onAdd: (key: SectionKey) => void }) {
  const [open, setOpen] = useState(false);
  const available = SECTION_KEYS.filter((k) => !used.includes(k));
  if (available.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/[0.03] px-4 py-3 text-sm font-medium text-primary transition-colors hover:border-primary hover:bg-primary/5"
      >
        <Plus className="h-4 w-4" />
        Dodaj sekcję
      </button>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between px-1">
        <h4 className="text-sm font-semibold">Wybierz sekcję</h4>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Zamknij listę sekcji"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {available.map((key) => {
          const { label, description, Icon } = SECTION_META[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                onAdd(key);
                setOpen(false);
              }}
              className="flex items-start gap-3 rounded-lg border border-transparent p-2.5 text-left transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">{description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CaseInlineEditor } from './CaseInlineEditor';
import { ADD_TILE, EDITABLE_TILE, activateOnKey, selectingText } from './inlineEdit';

interface Props {
  caseId: string;
  text: string | null;
  /** Gdy podane - klik w opis otwiera edycję w miejscu, brak opisu pokazuje kafelek „Dodaj opis”. */
  onSave?: (value: string) => Promise<boolean>;
}

/**
 * Opis sprawy: zwinięty do 5 linii, "Pokaż więcej" rozwija cały opis
 * w przewijanym obszarze (żeby długi opis nie rozpychał okna szczegółów).
 */
export function CaseDescription({ caseId, text, onSave }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExpanded(false);
    setEditing(false);
  }, [caseId]);

  // Pomiar tylko w stanie zwiniętym. ResizeObserver łapie layout po animacji
  // otwarcia Radixa i reflow po załadowaniu fontów.
  useLayoutEffect(() => {
    if (expanded || editing) return;
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, expanded, editing]);

  if (!text && !onSave) return null;

  const startEditing = () => {
    if (!selectingText()) setEditing(true);
  };

  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-medium">Opis</h3>
      {editing && onSave ? (
        <CaseInlineEditor
          initial={text ?? ''}
          label="Opis sprawy"
          placeholder="Co konkretnie się stało? Jaki jest oczekiwany rezultat?"
          onCancel={() => setEditing(false)}
          onSave={async (value) => {
            const ok = await onSave(value);
            if (ok) setEditing(false);
            return ok;
          }}
        />
      ) : text ? (
        <>
          <div
            ref={ref}
            {...(onSave && {
              role: 'button',
              'aria-label': 'Edytuj opis',
              onClick: startEditing,
              onKeyDown: (e: React.KeyboardEvent) => activateOnKey(e, () => setEditing(true)),
            })}
            tabIndex={onSave || expanded ? 0 : undefined}
            className={cn(
              'whitespace-pre-wrap text-sm leading-relaxed text-foreground/90',
              expanded
                ? 'max-h-80 overflow-y-auto overscroll-contain rounded-lg border bg-muted/30 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60'
                : 'line-clamp-5',
              onSave && cn(EDITABLE_TILE, !expanded && '-mx-2 px-2 py-1'),
            )}
          >
            {text}
          </div>
          {(overflows || expanded) && (
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-primary hover:underline max-md:min-h-10"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {expanded ? 'Zwiń' : 'Pokaż więcej'}
            </button>
          )}
        </>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className={ADD_TILE}>
          <Plus />
          Dodaj opis sprawy
        </button>
      )}
    </section>
  );
}

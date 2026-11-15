import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useWatch, type Control } from 'react-hook-form';
import { MousePointerClick, Monitor, Smartphone } from 'lucide-react';

import { renderNewsletter, type NewsletterIdentity, type PreviewBlockKey } from '@/lib/newsletter/render';
import type { NewsletterTemplate } from '@/lib/newsletter/types';
import { cn } from '@/lib/utils';

// ============================================================================
// Podgląd na żywo: klik w sekcję maila otwiera jej edycję, aktywna sekcja
// jest obrysowana. Treść iframe jest podmieniana bez przeładowania, więc
// przewinięcie podglądu nie skacze przy każdym znaku.
//
// iframe: sandbox="allow-same-origin" BEZ allow-scripts - skrypty w podglądzie
// nigdy się nie wykonają, a rodzic może podpiąć obsługę kliknięć do dokumentu.
// ============================================================================

type Device = 'desktop' | 'mobile';

interface Props {
  control: Control<NewsletterTemplate>;
  active: PreviewBlockKey | null;
  /** true gdy aktywną sekcję wybrano w edytorze - wtedy przewijamy do niej podgląd. */
  scrollToActive: boolean;
  onSelect: (key: PreviewBlockKey) => void;
  senderName: string;
  /** Dane posła z site_identity (nagłówek, RODO). */
  identity: NewsletterIdentity;
}

export function PreviewPane({ control, active, scrollToActive, onSelect, senderName, identity }: Props) {
  const values = useWatch({ control }) as NewsletterTemplate;
  const deferred = useDeferredValue(values);
  const html = useMemo(() => renderNewsletter(deferred, { mode: 'preview', identity }), [deferred, identity]);

  const [device, setDevice] = useState<Device>('desktop');
  const [initialHtml] = useState(html);
  const [doc, setDoc] = useState<Document | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const activeRef = useRef(active);
  activeRef.current = active;
  /** Sekcja do przewinięcia, której jeszcze nie ma w podglądzie (np. właśnie dodana - render jest odroczony). */
  const pendingScrollRef = useRef<PreviewBlockKey | null>(null);

  // Klik w podglądzie: wybór sekcji zamiast nawigacji po linkach.
  useEffect(() => {
    if (!doc) return;
    const handleClick = (e: MouseEvent) => {
      e.preventDefault();
      const block = (e.target as Element | null)?.closest?.('[data-section]');
      const key = block?.getAttribute('data-section');
      if (key) onSelectRef.current(key as PreviewBlockKey);
    };
    doc.addEventListener('click', handleClick);
    return () => doc.removeEventListener('click', handleClick);
  }, [doc]);

  // Podmiana treści bez przeładowania iframe; po podmianie odtwarzamy znacznik aktywnej sekcji.
  useEffect(() => {
    if (!doc?.body) return;
    const next = new DOMParser().parseFromString(html, 'text/html');
    doc.body.innerHTML = next.body.innerHTML;
    doc.title = next.title;
    const current = activeRef.current;
    const el = current ? doc.querySelector(`[data-section="${current}"]`) : null;
    el?.setAttribute('data-active', '');
    if (el && pendingScrollRef.current === current) {
      pendingScrollRef.current = null;
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [doc, html]);

  useEffect(() => {
    if (!doc?.body) return;
    doc.querySelectorAll('[data-active]').forEach((el) => el.removeAttribute('data-active'));
    pendingScrollRef.current = null;
    if (!active) return;
    const el = doc.querySelector(`[data-section="${active}"]`);
    el?.setAttribute('data-active', '');
    if (!scrollToActive) return;
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else pendingScrollRef.current = active;
  }, [doc, active, scrollToActive]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted/50">
      <div className="flex items-center gap-3 border-b bg-card/60 px-4 py-2">
        <span className="text-xs font-semibold text-muted-foreground">Podgląd</span>
        <span className="hidden items-center gap-1 text-xs text-muted-foreground xl:inline-flex">
          <MousePointerClick className="h-3.5 w-3.5" /> kliknij element maila, aby go edytować
        </span>
        <div className="ml-auto inline-flex rounded-lg bg-muted p-0.5" role="group" aria-label="Szerokość podglądu">
          {(
            [
              ['desktop', Monitor, 'Komputer'],
              ['mobile', Smartphone, 'Telefon'],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDevice(value)}
              aria-pressed={device === value}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                device === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <InboxRow senderName={senderName} subject={values.subject} preheader={values.preheader} />

      <div className="flex min-h-0 flex-1 justify-center overflow-hidden px-4 pb-4">
        <iframe
          ref={iframeRef}
          title="Podgląd newslettera"
          srcDoc={initialHtml}
          sandbox="allow-same-origin"
          onLoad={() => setDoc(iframeRef.current?.contentDocument ?? null)}
          className={cn(
            'h-full rounded-lg border bg-white shadow-sm transition-[width] duration-300',
            device === 'mobile' ? 'w-[390px] max-w-full' : 'w-full',
          )}
        />
      </div>
    </div>
  );
}

/** Jak mail wygląda na liście w skrzynce: nadawca, temat, zajawka. */
function InboxRow({ senderName, subject, preheader }: { senderName: string; subject: string; preheader: string }) {
  const initials = senderName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <div className="mx-4 my-3 flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-sm">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
        {initials || '?'}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-semibold">{senderName || 'Nadawca'}</span>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">teraz</span>
        </div>
        <p className="truncate">
          <span className={cn('font-medium', !subject.trim() && 'italic text-muted-foreground')}>
            {subject.trim() || 'Brak tematu'}
          </span>
          {preheader.trim() && <span className="text-muted-foreground"> — {preheader.trim()}</span>}
        </p>
      </div>
    </div>
  );
}

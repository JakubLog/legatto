import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { Button } from '@/components/ui/button';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Pliki pomocnicze kopiowane przez plugin `pdfjsAssets` w vite.config.ts. */
const ASSETS = '/pdfjs/';
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const FIT_ZOOM_IDX = ZOOM_STEPS.indexOf(1);
/** Przy "100%" strona nie szersza niż to, nawet w szerokim oknie. */
const MAX_FIT_WIDTH = 900;
/** iOS Safari nie rysuje canvasu większego niż ~16,7 Mpx. */
const MAX_CANVAS_PIXELS = 16_000_000;
/** Strona A4 zanim pdf.js poda wymiary. */
const DEFAULT_ASPECT = 1.414;

interface PageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  root: HTMLElement;
}

/** Strona rysowana tylko w pobliżu widoku; poza nim canvas jest zwalniany (długie skany). */
function PdfPage({ doc, pageNumber, width, root }: PageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    doc
      .getPage(pageNumber)
      .then((p) => {
        if (!cancelled) setPage(p);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root,
      rootMargin: '100% 0px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!page || !canvas) return;
    if (!visible) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    const base = page.getViewport({ scale: 1 });
    let scale = (width / base.width) * Math.min(window.devicePixelRatio || 1, 2);
    const area = base.width * base.height * scale * scale;
    if (area > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / area);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const task = page.render({ canvas, viewport });
    // Anulowanie (przewinięcie, zoom, zamknięcie) odrzuca promise - to nie jest błąd.
    task.promise.catch(() => undefined);
    return () => task.cancel();
  }, [page, visible, width]);

  const base = page?.getViewport({ scale: 1 });
  const height = base ? (width * base.height) / base.width : width * DEFAULT_ASPECT;

  return (
    <div
      ref={wrapRef}
      role="img"
      aria-label={`Strona ${pageNumber}`}
      className="shrink-0 bg-white shadow-card"
      style={{ width, height }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

function pagesLabel(n: number): string {
  if (n === 1) return 'strona';
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'strony' : 'stron';
}

interface Props {
  blob: Blob;
  /** Widok, gdy pdf.js nie otworzy pliku (uszkodzony, zaszyfrowany hasłem). */
  fallback: ReactNode;
}

/** Podgląd PDF renderowany przez pdf.js: działa także tam, gdzie przeglądarka nie osadza PDF (Android). */
export default function PdfViewer({ blob, fallback }: Props) {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [fitWidth, setFitWidth] = useState(0);
  const [zoomIdx, setZoomIdx] = useState(FIT_ZOOM_IDX);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    setFailed(false);
    // pdf.js przenosi bufor do workera, więc każde otwarcie dostaje świeżą kopię z bloba.
    blob
      .arrayBuffer()
      .then((data) => {
        if (cancelled) return null;
        task = getDocument({
          data,
          cMapUrl: `${ASSETS}cmaps/`,
          standardFontDataUrl: `${ASSETS}standard_fonts/`,
          wasmUrl: `${ASSETS}wasm/`,
          // CSP bez 'wasm-unsafe-eval': dekodery skanów (JBIG2, JPEG 2000) ładowane jako JS z wasmUrl.
          useWasm: false,
        });
        return task.promise;
      })
      .then((d) => {
        if (d && !cancelled) setDoc(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      setDoc(null);
      void task?.destroy();
    };
  }, [blob]);

  useEffect(() => {
    if (!scrollEl) return;
    const observer = new ResizeObserver(([entry]) => {
      // 24 px = padding kontenera stron (p-3 z obu stron).
      setFitWidth(Math.max(0, Math.floor(entry.contentRect.width) - 24));
    });
    observer.observe(scrollEl);
    return () => observer.disconnect();
  }, [scrollEl]);

  if (failed) return <>{fallback}</>;

  const zoom = ZOOM_STEPS[zoomIdx];
  const width = Math.round(Math.min(fitWidth, MAX_FIT_WIDTH) * zoom);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b bg-card px-3 py-1 text-xs text-muted-foreground">
        <span>{doc ? `${doc.numPages} ${pagesLabel(doc.numPages)}` : 'Wczytywanie…'}</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 max-md:h-10 max-md:w-10"
            disabled={zoomIdx === 0}
            onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
            aria-label="Pomniejsz"
            title="Pomniejsz"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <button
            type="button"
            className="min-w-12 rounded-md px-1 py-1 tabular-nums hover:bg-accent hover:text-foreground max-md:min-h-10"
            onClick={() => setZoomIdx(FIT_ZOOM_IDX)}
            title="Dopasuj do szerokości"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 max-md:h-10 max-md:w-10"
            disabled={zoomIdx === ZOOM_STEPS.length - 1}
            onClick={() => setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
            aria-label="Powiększ"
            title="Powiększ"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div ref={setScrollEl} className="min-h-0 flex-1 overflow-auto">
        {!doc || !scrollEl || width === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex min-w-max flex-col items-center gap-3 p-3">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i} doc={doc} pageNumber={i + 1} width={width} root={scrollEl} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

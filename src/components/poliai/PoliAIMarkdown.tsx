import { memo, useMemo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSmoothText } from '@/hooks/useSmoothText';
import { cn } from '@/lib/utils';
import { rehypeFadeWords } from './streamFade';
import { ExternalLink } from './ExternalLink';
import { SystemLink } from './SystemLink';
import { SENTENCE_START_PROP, rehypeMarkSentenceStart } from './sentenceStart';

interface PoliAIMarkdownProps {
  text: string;
  onNavigate: (href: string) => void;
  /** Tura strumieniowana w tej sesji - płynne odsłanianie i fade-in słów. */
  animate?: boolean;
  /** Blok wciąż przychodzi ze strumienia. */
  live?: boolean;
}

// Tekst modelu może nieść prompt injection (sprawy z formularza publicznego, ICS, OCR) - zostawiamy
// tylko linki http(s)/mailto/tel i ścieżki w obrębie aplikacji (javascript:, data: i inne schematy
// odpadają - urlTransform zwraca null, link zostaje samym tekstem). `//host` i `\` odpadają:
// przeglądarka i router traktują je jak adres innego hosta (open redirect). Linki poza panel
// pokazują host, a niezaufane albo z parametrami otwierają się po potwierdzeniu (ExternalLink).
const EXTERNAL_URL = /^(https?:|mailto:|tel:)/i;
const APP_PATH = /^\/(?![/\\])[^\\\s]*$/;

function safeMarkdownUrl(url: string, key: string): string | null {
  if (key !== 'href') return null;
  const value = url.trim();
  if (value.includes('\\')) return null;
  return EXTERNAL_URL.test(value) || APP_PATH.test(value) ? value : null;
}

function buildComponents(onNavigate: (href: string) => void): Components {
  return {
    a: ({ href, children, node }) => {
      if (!href) return <span>{children}</span>;
      if (href.startsWith('/biuro')) {
        return (
          <SystemLink href={href} sentenceStart={node?.properties?.[SENTENCE_START_PROP] === 'true'} onNavigate={onNavigate}>
            {children}
          </SystemLink>
        );
      }
      return <ExternalLink href={href}>{children}</ExternalLink>;
    },
    // Obrazki nigdy nie są ładowane (zdalny <img> = wyciek danych bez kliknięcia) - zostaje sam opis.
    img: ({ alt }) => (alt ? <span>{alt}</span> : null),
    p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
    h1: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
    h2: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
    h3: ({ children }) => <h4 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h4>,
    h4: ({ children }) => <h4 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h4>,
    ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>,
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-primary/30 pl-3 text-muted-foreground">{children}</blockquote>
    ),
    hr: () => <hr className="my-3 border-border" />,
    code: ({ children, className }) => (
      <code className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]', className)}>{children}</code>
    ),
    pre: ({ children }) => (
      <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs [&>code]:bg-transparent [&>code]:p-0">
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-[13px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
    th: ({ children }) => <th className="border-b px-2.5 py-1.5 text-left font-semibold">{children}</th>,
    td: ({ children }) => <td className="border-b px-2.5 py-1.5 align-top [tr:last-child>&]:border-b-0">{children}</td>,
  };
}

/** Odpowiedź PoliAI w markdownie (GFM: tabele, listy zadań). Surowy HTML i obrazki nie są renderowane. */
export const PoliAIMarkdown = memo(function PoliAIMarkdown({ text, onNavigate, animate = false, live }: PoliAIMarkdownProps) {
  const shown = useSmoothText(text, animate);
  const typing = Boolean(live) || shown.length < text.length;
  // Stałe typy komponentów - nowe funkcje przy każdym renderze przemontowałyby całe drzewo w każdej
  // klatce odsłaniania, restartując fade-in słów (tekst niewidoczny w trakcie strumienia).
  const components = useMemo(() => buildComponents(onNavigate), [onNavigate]);
  return (
    <div
      className={cn(
        'text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]',
        typing && "[&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:inline-block [&>*:last-child]:after:h-3.5 [&>*:last-child]:after:w-1.5 [&>*:last-child]:after:animate-pulse [&>*:last-child]:after:rounded-sm [&>*:last-child]:after:bg-primary/60 [&>*:last-child]:after:align-middle [&>*:last-child]:after:content-['']",
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={animate ? [rehypeMarkSentenceStart, rehypeFadeWords] : [rehypeMarkSentenceStart]}
        components={components}
        urlTransform={safeMarkdownUrl}
      >
        {shown}
      </Markdown>
    </div>
  );
});

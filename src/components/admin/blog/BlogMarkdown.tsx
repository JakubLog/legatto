import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

// Podgląd treści wpisu w edytorze. Bez surowego HTML (skipHtml) - tak samo renderuje strona posła.
// Linki tylko http(s)/mailto/tel i ścieżki względne; obrazy tylko https/http (zdjęcia z site-assets).
const SAFE_LINK = /^(https?:|mailto:|tel:|\/(?![/\\])|#)/i;
const SAFE_IMAGE = /^https?:\/\//i;

function urlTransform(url: string, key: string): string | null {
  const value = url.trim();
  if (value.includes('\\')) return null;
  if (key === 'src') return SAFE_IMAGE.test(value) ? value : null;
  return SAFE_LINK.test(value) ? value : null;
}

const COMPONENTS: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-primary underline underline-offset-2">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) =>
    typeof src === 'string' && src ? (
      <img src={src} alt={alt ?? ''} loading="lazy" className="my-3 max-h-[420px] rounded-lg border object-contain" />
    ) : alt ? (
      <span>{alt}</span>
    ) : null,
  p: ({ children }) => <p className="my-3 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h2 className="mb-3 mt-6 text-2xl font-bold first:mt-0">{children}</h2>,
  h2: ({ children }) => <h2 className="mb-3 mt-6 text-xl font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-5 text-lg font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6 marker:text-muted-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6 marker:text-muted-foreground">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-4 border-primary/30 pl-4 italic text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-6 border-border" />,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
  pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-lg border bg-muted/50 p-3 text-sm">{children}</pre>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border px-2 py-1 align-top">{children}</td>,
};

export const BlogMarkdown = memo(function BlogMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('break-words text-[15px] text-foreground', className)}>
      <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={urlTransform} components={COMPONENTS}>
        {text}
      </Markdown>
    </div>
  );
});

import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { SitePost } from '@/lib/siteSnapshot';
import { cn } from '@/lib/utils';
import { publicCard, publicCardHover, publicContainer, publicFocus, publicH1, publicInner, publicKicker, publicSection } from '@/components/public/styles';

// Blog i strona 404 strony statycznej posła (site/render.tsx) - czysty HTML z SSR, bez wysp.
// Treść wpisów: Markdown (react-markdown + remark-gfm) bez surowego HTML. Obrazy tylko lokalne
// (/assets/<sha256>.<ext> przepisane przez generator) - zdalny obraz zdradzałby odwiedzających.

const LOCAL_ASSET = /^\/assets\/[0-9a-f]{64}\.(png|jpg|webp|gif)$/;
const SAFE_LINK = /^(https?:|mailto:|tel:|\/(?![/\\])|#)/i;

function urlTransform(url: string, key: string): string | null {
  const value = url.trim();
  if (value.includes('\\')) return null;
  if (key === 'src') return LOCAL_ASSET.test(value) ? value : null;
  return SAFE_LINK.test(value) ? value : null;
}

const link = cn('font-semibold text-brand underline underline-offset-2', publicFocus);

const COMPONENTS: Components = {
  a: ({ href, children }) => {
    if (!href) return <span>{children}</span>;
    const external = /^https?:/i.test(href);
    return (
      <a href={href} className={link} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    );
  },
  img: ({ src, alt }) =>
    typeof src === 'string' && src ? (
      <img src={src} alt={alt ?? ''} loading="lazy" className="my-6 h-auto w-full rounded-[var(--public-radius-card)]" />
    ) : null,
  p: ({ children }) => <p className="my-4 leading-relaxed">{children}</p>,
  h1: ({ children }) => <h2 className="mb-3 mt-10 text-2xl font-bold">{children}</h2>,
  h2: ({ children }) => <h2 className="mb-3 mt-10 text-2xl font-bold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-8 text-xl font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-2 mt-6 text-lg font-semibold">{children}</h4>,
  ul: ({ children }) => <ul className="my-4 list-disc space-y-1.5 pl-6 marker:text-brand">{children}</ul>,
  ol: ({ children }) => <ol className="my-4 list-decimal space-y-1.5 pl-6 marker:text-brand">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="my-6 border-l-4 border-brand pl-5 text-lg italic text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-10 border-border" />,
  code: ({ children }) => <code className="rounded bg-cream-2 px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
  pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-lg bg-cream-2 p-4 text-sm">{children}</pre>,
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto">
      <table className="w-full border-collapse text-[15px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border px-3 py-2 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-border px-3 py-2 align-top">{children}</td>,
};

function BlogCover({ post, className }: { post: SitePost; className?: string }) {
  if (!LOCAL_ASSET.test(post.cover_path)) return null;
  return <img src={post.cover_path} alt="" className={cn('w-full object-cover', className)} />;
}

/** Lista opublikowanych wpisów (/blog/), od najnowszego. */
export function PublicBlogIndex({ posts }: { posts: SitePost[] }) {
  return (
    <section aria-labelledby="blog-title" className={cn('bg-background', publicSection)}>
      <div className={publicContainer}>
        <div className={publicInner}>
          <p className={cn(publicKicker, 'mb-3')}>Blog</p>
          <h1 id="blog-title" className={publicH1}>
            Aktualności
          </h1>
          {posts.length === 0 ? (
            <p className="mt-8 text-muted-foreground">Nie ma jeszcze opublikowanych wpisów.</p>
          ) : (
            <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <li key={post.slug}>
                  <a
                    href={`/blog/${post.slug}/`}
                    className={cn(publicCard, publicCardHover, 'flex h-full flex-col overflow-hidden', publicFocus)}
                  >
                    <BlogCover post={post} className="aspect-[16/9]" />
                    <span className="flex flex-1 flex-col gap-2 p-5 sm:p-6">
                      <time dateTime={post.published_at} className="text-xs font-medium text-muted-foreground">
                        {format(new Date(post.published_at), 'd MMMM yyyy', { locale: pl })}
                      </time>
                      <span className="text-lg font-bold leading-snug">{post.title}</span>
                      {post.excerpt && <span className="line-clamp-3 text-sm text-muted-foreground">{post.excerpt}</span>}
                      <span className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-semibold text-brand">
                        Czytaj dalej <ArrowRight className="h-4 w-4" aria-hidden />
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** Pojedynczy wpis (/blog/<slug>/). */
export function PublicBlogPost({ post }: { post: SitePost }) {
  return (
    <article aria-labelledby="post-title" className={cn('bg-background', publicSection)}>
      <div className={publicContainer}>
        <div className="mx-auto max-w-3xl">
          <a href="/blog/" className={cn('inline-flex min-h-10 items-center gap-1.5 rounded text-sm font-semibold text-brand', publicFocus)}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Wszystkie wpisy
          </a>
          <time dateTime={post.published_at} className="mt-6 block text-sm font-medium text-muted-foreground">
            {format(new Date(post.published_at), 'd MMMM yyyy', { locale: pl })}
          </time>
          <h1 id="post-title" className={cn(publicH1, 'mt-2')}>
            {post.title}
          </h1>
          {post.excerpt && <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{post.excerpt}</p>}
          <BlogCover post={post} className="mt-8 rounded-[var(--public-radius-card)]" />
          <div className="mt-8 break-words text-[17px] text-foreground">
            <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={urlTransform} components={COMPONENTS}>
              {post.body_md}
            </Markdown>
          </div>
        </div>
      </div>
    </article>
  );
}

/** Strona 404 strony statycznej. */
export function PublicNotFound() {
  return (
    <section aria-labelledby="notfound-title" className={cn('bg-background', publicSection)}>
      <div className={publicContainer}>
        <div className="mx-auto max-w-xl py-10 text-center">
          <p className={cn(publicKicker, 'mb-3')}>Błąd 404</p>
          <h1 id="notfound-title" className={publicH1}>
            Nie znaleziono strony
          </h1>
          <p className="mt-4 text-muted-foreground">Adres jest niepełny albo strona została usunięta.</p>
          <a
            href="/"
            className={cn('mt-8 inline-flex min-h-11 items-center gap-1.5 rounded-lg font-semibold text-brand', publicFocus)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Strona główna
          </a>
        </div>
      </div>
    </section>
  );
}

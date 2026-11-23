import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { PublicBlogIndex, PublicBlogPost, PublicNotFound } from '@/components/public/PublicBlog';
import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHome, type PublicHomeSlots } from '@/components/public/PublicHome';
import type { DistrictGeo } from '@/components/public/PublicOfficesMap';
import { externalNavLinks, officesHref, sectionNavLinks, type PublicNavItem } from '@/components/public/publicNav';
import { publicThemeVars } from '@/lib/publicTheme';
import type { SitePost, SiteSnapshot } from '@/lib/siteSnapshot';
import {
  Island,
  IslandCollector,
  IslandCollectorContext,
  islandElement,
  islandPlaceholder,
  ISLANDS_SCRIPT_ID,
  newIslandQueryClient,
} from './islands';

// Moduł SSR generatora strony statycznej (build: `vite build -c site/vite.config.ts --ssr site/render.tsx`
// -> site/dist/server/render.js). Ładuje go `site.mjs build` (site/build.ts) bez sieci: dostaje
// przygotowaną migawkę (zasoby już lokalne) i zwraca gotowe dokumenty HTML.

export interface ClientAssets {
  /** Skrypt modułu klienta (hydratacja wysp), np. /_app/client-abc.js. */
  entry: string;
  css: string[];
  /** Chunki importowane przez wejście (modulepreload). */
  preload: string[];
}

export interface RenderInput {
  /** Migawka po `site.mjs snapshot` (zdjęcia jako /assets/..., newslettery /n/a/...). */
  snapshot: SiteSnapshot;
  /** Origin strony posła (https://domena) - link kanoniczny i og:image. */
  origin: string;
  turnstileSiteKey: string;
  /** Granice okręgu do mapy biur (SVG w HTML); null = bez mapy. */
  geo: DistrictGeo | null;
  client: ClientAssets;
  /** Chwila builda (ISO): kalendarz do hydratacji, rok w stopce. */
  now: string;
}

export interface RenderedPage {
  /** Ścieżka pliku względem katalogu wyjściowego, np. `blog/wpis/index.html`. */
  path: string;
  html: string;
}

const BLOG_LINK: PublicNavItem = { href: '/blog/', label: 'Blog' };

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface PageMeta {
  title: string;
  description: string;
  /** Ścieżka URL strony (link kanoniczny); null = bez kanonicznego (404). */
  urlPath: string | null;
  noindex?: boolean;
}

function renderDocument(input: RenderInput, meta: PageMeta, body: ReactNode): string {
  const { snapshot, client } = input;
  const { identity, homepage } = snapshot;

  const collector = new IslandCollector();
  let html = renderToString(<IslandCollectorContext.Provider value={collector}>{body}</IslandCollectorContext.Provider>);
  collector.records.forEach((record, index) => {
    const placeholder = islandPlaceholder(String(index), record.name);
    if (!html.includes(placeholder)) throw new Error(`render: brak kontenera wyspy ${record.name}#${index}`);
    const inner = renderToString(islandElement(record, newIslandQueryClient()));
    html = html.replace(placeholder, () => placeholder.replace('></div>', `>${inner}</div>`));
  });

  const vars = publicThemeVars(homepage.appearance, false);
  const style = Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
    `<title>${escapeHtml(meta.title)}</title>`,
    meta.description ? `<meta name="description" content="${escapeHtml(meta.description)}">` : '',
    meta.noindex ? '<meta name="robots" content="noindex">' : '',
    meta.urlPath ? `<link rel="canonical" href="${escapeHtml(input.origin + meta.urlPath)}">` : '',
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    meta.description ? `<meta property="og:description" content="${escapeHtml(meta.description)}">` : '',
    identity.photo_url.startsWith('/assets/')
      ? `<meta property="og:image" content="${escapeHtml(input.origin + identity.photo_url)}">`
      : '',
    '<meta property="og:locale" content="pl_PL">',
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    ...client.css.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`),
    ...client.preload.map((href) => `<link rel="modulepreload" href="${escapeHtml(href)}">`),
    `<script type="module" src="${escapeHtml(client.entry)}"></script>`,
  ].filter(Boolean);
  // JSON w <script type="application/json"> nie jest wykonywany (CSP script-src 'self' bez zmian);
  // `<` zamieniony na \u003c - treść nie zamknie znacznika.
  const islands = JSON.stringify(collector.records).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="pl" class="theme-public" data-public-template="${escapeHtml(homepage.appearance.template)}" style="${escapeHtml(style)}">
<head>
${head.join('\n')}
</head>
<body>
<div id="root">${html}</div>
<script type="application/json" id="${ISLANDS_SCRIPT_ID}">${islands}</script>
</body>
</html>
`;
}

/** Nagłówek (wyspa: menu mobilne), treść i stopka - wspólna rama każdej podstrony. */
function Frame({ input, onHome, children }: { input: RenderInput; onHome: boolean; children: ReactNode }) {
  const { identity, homepage, posts } = input.snapshot;
  const base = onHome ? '' : '/';
  const sections = sectionNavLinks(homepage, base);
  const blog = posts.length > 0 ? [BLOG_LINK] : [];
  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <Island
        name="header"
        props={{ identity, promo: homepage.promo, navLinks: [...sections, ...blog, ...externalNavLinks(homepage)] }}
      />
      <main className="flex-1">{children}</main>
      <PublicFooter
        identity={identity}
        footer={homepage.footer}
        sectionLinks={[...sections, ...blog]}
        officesHref={officesHref(homepage, base)}
        year={new Date(input.now).getFullYear()}
      />
    </div>
  );
}

function homeSlots(input: RenderInput): PublicHomeSlots {
  return {
    calendar: (props) => <Island name="calendar" props={{ ...props, initialNow: input.now }} />,
    officeCard: (props) => <Island name="office-card" props={props} />,
    submitForm: ({ identity, colorScheme, dictionaries }) => (
      <Island
        name="submit-form"
        props={{
          identity,
          colorScheme,
          turnstileSiteKey: input.turnstileSiteKey,
          // Tylko pola potrzebne formularzowi - mniej JSON-a w stronie.
          dictionaries: {
            powiaty: dictionaries.powiaty.map(({ id, name }) => ({ id, name })),
            gminy: dictionaries.gminy.map(({ id, powiat_id, name }) => ({ id, powiat_id, name })),
            categories: dictionaries.categories.map(({ id, name }) => ({ id, name })),
          },
        }}
      />
    ),
  };
}

function postPage(input: RenderInput, post: SitePost, siteTitle: string): RenderedPage {
  return {
    path: `blog/${post.slug}/index.html`,
    html: renderDocument(
      input,
      { title: `${post.title} - ${siteTitle}`, description: post.excerpt, urlPath: `/blog/${post.slug}/` },
      <Frame input={input} onHome={false}>
        <PublicBlogPost post={post} />
      </Frame>,
    ),
  };
}

/** Wszystkie strony HTML: /, /blog/ i wpisy (gdy są opublikowane wpisy), 404. */
export function renderSite(input: RenderInput): RenderedPage[] {
  const { snapshot } = input;
  const seo = snapshot.homepage.seo;
  const pages: RenderedPage[] = [
    {
      path: 'index.html',
      html: renderDocument(
        input,
        { title: seo.title, description: seo.description, urlPath: '/' },
        <Frame input={input} onHome>
          <PublicHome site={snapshot} geo={input.geo} slots={homeSlots(input)} />
        </Frame>,
      ),
    },
    {
      path: '404.html',
      html: renderDocument(
        input,
        { title: `Nie znaleziono strony - ${seo.title}`, description: '', urlPath: null, noindex: true },
        <Frame input={input} onHome={false}>
          <PublicNotFound />
        </Frame>,
      ),
    },
  ];
  if (snapshot.posts.length > 0) {
    pages.push({
      path: 'blog/index.html',
      html: renderDocument(
        input,
        { title: `Blog - ${seo.title}`, description: seo.description, urlPath: '/blog/' },
        <Frame input={input} onHome={false}>
          <PublicBlogIndex posts={snapshot.posts} />
        </Frame>,
      ),
    });
    for (const post of snapshot.posts) pages.push(postPage(input, post, seo.title));
  }
  return pages;
}

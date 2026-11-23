import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';
import { deploymentTarget } from './api/_lib/instance.ts';
import { createAppHandler } from './server/app.ts';
import type { VercelHandler } from './server/handlers.ts';
import { matchApiRoute } from './server/routes.ts';
import {
  APP_TITLE_PLACEHOLDER,
  appTitle,
  buildRuntimeConfig,
  escapeHtml,
  parsePublicOrigin,
  renderRuntimeConfigScript,
} from './server/runtime-config.ts';
import { applyRewrites, loadVercelConfig } from './server/vercel-config.ts';

/**
 * Dwa cele builda:
 * - Vercel (domyślnie): konfiguracja instancji ze zmiennych VITE_* środowiska builda; `/runtime-config.js`
 *   powstaje statycznie, tytuł trafia do index.html i manifestu PWA, CSP zawiera host Supabase.
 * - VPS (`LEGATTO_TARGET=selfhost`): jeden build dla wszystkich biur. `/runtime-config.js` generuje serwer
 *   (server/) z env kontenera, w index.html i manifeście zostaje %APP_TITLE% (podstawia serwer), a Supabase
 *   jest pod tym samym originem (CSP 'self').
 */

function appVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version: string };
  return process.env.LEGATTO_VERSION?.trim() || pkg.version;
}

function instanceHtml(title: string | null): Plugin {
  return {
    name: 'instance-html',
    transformIndexHtml: (html) => (title === null ? html : html.replaceAll(APP_TITLE_PLACEHOLDER, escapeHtml(title))),
  };
}

/**
 * CSP instancji w `<meta>` (build-time), żeby kod i `vercel.json` były wspólne dla wszystkich instancji
 * (ADR 026). Nagłówek CSP w `vercel.json` ma tylko dyrektywy niezależne od instancji (w tym
 * `frame-ancestors`, którego `<meta>` nie obsługuje); przeglądarka egzekwuje obie polityki naraz.
 * Vercel: hosty projektu Supabase z VITE_SUPABASE_URL. VPS: Supabase pod originem strony ('self').
 * W dev brak meta (preambuła React Refresh jest inline).
 */
function instanceCsp(env: Record<string, string>): Plugin {
  return {
    name: 'instance-csp',
    apply: 'build',
    transformIndexHtml() {
      // VPS: gateway Supabase pod originem strony - wystarcza 'self' (CSP3 obejmuje też wss tego hosta).
      let api = '';
      let ws = '';
      if (deploymentTarget(env) === 'vercel') {
        let origin: string;
        try {
          origin = parsePublicOrigin(env.VITE_SUPABASE_URL?.trim() ?? '', 'VITE_SUPABASE_URL');
        } catch (err) {
          throw new Error(
            `Build Vercel wymaga poprawnego VITE_SUPABASE_URL (np. https://<ref>.supabase.co) - z niego powstaje CSP instancji: ${(err as Error).message}`,
          );
        }
        const url = new URL(origin);
        api = ` ${origin}`;
        ws = ` ${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
      }
      const policy = [
        "default-src 'self'",
        "script-src 'self' https://challenges.cloudflare.com",
        `frame-src https://challenges.cloudflare.com ${api ? api.trim() : "'self'"}`,
        `connect-src 'self'${api}${ws} https://challenges.cloudflare.com`,
        `img-src 'self' data: blob:${api}`,
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "worker-src 'self'",
        "manifest-src 'self'",
      ].join('; ');
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
    },
  };
}

/**
 * `/runtime-config.js`: w dev serwowany z `.env.local`, w buildzie Vercela emitowany jako plik statyczny.
 * Build self-host go nie zawiera - generuje go server/ przy każdym żądaniu.
 */
function runtimeConfig(env: Record<string, string>): Plugin {
  const script = () => renderRuntimeConfigScript(buildRuntimeConfig(env, { version: appVersion() }));
  return {
    name: 'runtime-config',
    configureServer(server) {
      server.middlewares.use('/runtime-config.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(script());
      });
    },
    generateBundle() {
      if (deploymentTarget(env) === 'selfhost') return;
      this.emitFile({ type: 'asset', fileName: 'runtime-config.js', source: script() });
    },
  };
}

/**
 * `pnpm dev` uruchamia funkcje z `api/` tym samym adapterem co serwer VPS (server/app.ts): trasy,
 * rewrites i nagłówki z vercel.json, limity treści i czasu. Moduły ładuje `ssrLoadModule` (HMR).
 * Zmienne bez prefiksu VITE_ (np. SUPABASE_SERVICE_ROLE_KEY z `.env.local`) trafiają tylko do
 * procesu serwera deweloperskiego, nie do bundla klienta.
 */
function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      for (const [key, value] of Object.entries(env)) process.env[key] ??= value;
      const config = loadVercelConfig(path.resolve(__dirname, 'vercel.json'));
      const handle = createAppHandler({
        config,
        loadHandler: async (file) => (await server.ssrLoadModule(`/${file}`)).default as VercelHandler,
        staticFiles: null,
        env: process.env,
        version: appVersion(),
        trustedProxies: new Set(),
      });
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://dev.invalid').pathname;
        const rewritten = applyRewrites(config, pathname);
        if (!matchApiRoute(pathname) && !(rewritten && matchApiRoute(rewritten.pathname))) return next();
        handle(req, res).catch(next);
      });
    },
  };
}

const PDFJS_ROOT = path.resolve(__dirname, 'node_modules/pdfjs-dist');
/**
 * Pliki pomocnicze pdf.js pobierane w trakcie renderowania PDF (src/components/files/PdfViewer.tsx):
 * mapy CMap, standardowe fonty i dekodery JBIG2/JPEG 2000 w JS (skany). Moduły .wasm pomijamy,
 * bo CSP nie zezwala na 'wasm-unsafe-eval', a viewer ustawia `useWasm: false`.
 */
const PDFJS_ASSETS: Record<string, (name: string) => boolean> = {
  cmaps: () => true,
  standard_fonts: () => true,
  wasm: (name) => name.endsWith('_nowasm_fallback.js') || name.startsWith('LICENSE'),
};

/** Serwuje `/pdfjs/<katalog>/<plik>` z node_modules w dev i kopiuje te same pliki do builda. */
function pdfjsAssets(): Plugin {
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const [dir, name, ...rest] = decodeURIComponent((req.url ?? '').split('?')[0]).split('/').filter(Boolean);
        const allowed = Boolean(name) && !name.startsWith('.') && rest.length === 0 && Object.hasOwn(PDFJS_ASSETS, dir);
        if (!allowed || !PDFJS_ASSETS[dir](name)) return next();
        fs.readFile(path.join(PDFJS_ROOT, dir, name), (err, data) => {
          if (err) return next();
          if (name.endsWith('.js')) res.setHeader('Content-Type', 'text/javascript');
          res.end(data);
        });
      });
    },
    generateBundle() {
      for (const [dir, include] of Object.entries(PDFJS_ASSETS)) {
        for (const name of fs.readdirSync(path.join(PDFJS_ROOT, dir))) {
          if (!include(name)) continue;
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${dir}/${name}`,
            source: fs.readFileSync(path.join(PDFJS_ROOT, dir, name)),
          });
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const selfhost = deploymentTarget(env) === 'selfhost';
  // Tytuł w index.html i manifeście: Vercel - z builda; VPS - placeholder podstawiany przez serwer.
  const title = selfhost ? null : appTitle(env);
  return {
    server: {
      port: 8080,
      // Serwer dev uruchamia api/ z kluczem service_role z .env.local - domyślnie tylko localhost.
      // Dostęp z sieci (np. test na telefonie): VITE_DEV_HOST=0.0.0.0 (env procesu albo .env.local).
      host: env.VITE_DEV_HOST?.trim() || 'localhost',
    },
    // Konfiguracja instancji nie trafia do bundla (src/lib/runtime-config.ts czyta /runtime-config.js).
    envPrefix: 'VITE_',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    plugins: [
      react(),
      pdfjsAssets(),
      instanceHtml(title),
      instanceCsp(env),
      runtimeConfig(env),
      devApi(env),
      VitePWA({
        disable: mode === 'development',
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icons/icon.svg'],
        manifest: {
          name: title ?? APP_TITLE_PLACEHOLDER,
          short_name: 'Biuro',
          description: 'System organizacji pracy biura poselskiego',
          lang: 'pl',
          theme_color: '#ffffff',
          background_color: '#F7F8FA',
          display: 'standalone',
          orientation: 'portrait',
          // id = tożsamość aplikacji (dawny start_url), żeby zmiana start_url nie tworzyła nowej PWA.
          id: '/',
          start_url: '/biuro',
          scope: '/',
          icons: [
            { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2,geojson}'],
          // Pliki pdf.js (dekodery skanów, fonty) pobierane tylko przy podglądzie PDF; fonty newslettera
          // tylko dla wersji online i e-maili (public/fonts/newsletter) - poza precache PWA.
          // runtime-config.js zmienia się bez nowego builda (flagi biura) - nigdy z precache.
          globIgnores: ['pdfjs/**', 'fonts/newsletter/**', 'runtime-config.js'],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname === '/runtime-config.js',
              handler: 'NetworkFirst',
              options: { cacheName: 'runtime-config', networkTimeoutSeconds: 5 },
            },
          ],
          navigateFallback: '/index.html',
          // /n/<slug> = wersja online newslettera serwowana przez api/newsletter-view (nie SPA).
          navigateFallbackDenylist: [/^\/api\//, /^\/n\//],
          // Obsługa web push (public/push-sw.js) w wygenerowanym service workerze.
          importScripts: ['/push-sw.js'],
        },
      }),
    ],
    build: {
      target: 'es2020',
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-query': ['@tanstack/react-query'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-ui': [
              '@radix-ui/react-avatar',
              '@radix-ui/react-dialog',
              '@radix-ui/react-dropdown-menu',
              '@radix-ui/react-label',
              '@radix-ui/react-select',
              '@radix-ui/react-separator',
              '@radix-ui/react-slot',
              '@radix-ui/react-toast',
              'cmdk',
              'lucide-react',
              'sonner',
            ],
            'vendor-forms': ['react-hook-form', 'zod', '@hookform/resolvers'],
            'vendor-d3-geo': ['d3-geo'],
          },
        },
      },
    },
  };
});

import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Tytuł aplikacji instancji (jedna instancja = jeden poseł) - build-time, bo `index.html`
 * (karta przeglądarki przed JS, podglądy w mediach społecznościowych) i manifest PWA są statyczne.
 * Vercel → Environment Variables: VITE_APP_TITLE, np. "Biuro Poselskie | Jan Kowalski".
 */
const DEFAULT_APP_TITLE = 'Biuro Poselskie';

function appTitle(mode: string): string {
  return loadEnv(mode, process.cwd(), 'VITE_').VITE_APP_TITLE?.trim() || DEFAULT_APP_TITLE;
}

function instanceHtml(title: string): Plugin {
  const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return {
    name: 'instance-html',
    transformIndexHtml: (html) => html.replaceAll('%APP_TITLE%', escaped),
  };
}

/**
 * CSP instancji w `<meta>` (build-time): hosty zależne od projektu Supabase tej instancji, żeby kod i `vercel.json`
 * były wspólne dla wszystkich instancji (ADR 026). Nagłówek CSP w `vercel.json` ma tylko dyrektywy niezależne od
 * instancji (w tym `frame-ancestors`, którego `<meta>` nie obsługuje); przeglądarka egzekwuje obie polityki naraz.
 * W dev brak meta (preambuła React Refresh jest inline).
 */
function instanceCsp(mode: string): Plugin {
  return {
    name: 'instance-csp',
    apply: 'build',
    transformIndexHtml() {
      const raw = loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL?.trim();
      let url: URL;
      try {
        url = new URL(raw ?? '');
      } catch {
        throw new Error('Build wymaga poprawnego VITE_SUPABASE_URL (np. https://<ref>.supabase.co) - z niego powstaje CSP instancji.');
      }
      const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
        throw new Error(`VITE_SUPABASE_URL musi używać https (http tylko dla localhost): ${url.origin}`);
      }
      const api = url.origin;
      const ws = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
      const policy = [
        "default-src 'self'",
        "script-src 'self' https://challenges.cloudflare.com",
        `frame-src https://challenges.cloudflare.com ${api}`,
        `connect-src 'self' ${api} ${ws} https://challenges.cloudflare.com`,
        `img-src 'self' data: blob: ${api}`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
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

interface DevApiRoute {
  module: string;
  /** Zmienne serwerowe wymagane przez funkcję - bez nich czytelny błąd zamiast 500. */
  requiredEnv?: string[];
}

/**
 * `pnpm dev` nie uruchamia funkcji Vercela z `api/`. Tu podpinamy wybrane funkcje przez
 * `ssrLoadModule` z minimalnym adapterem VercelRequest/VercelResponse (body JSON, status, json,
 * strumień przez natywne write). Reszta wymaga `vercel dev`.
 * Zmienne bez prefiksu VITE_ (np. SUPABASE_SERVICE_ROLE_KEY z `.env.local`) trafiają tylko do
 * procesu serwera deweloperskiego, nie do bundla klienta.
 */
function vercelDevApi(mode: string, routes: Record<string, DevApiRoute>): Plugin {
  return {
    name: 'vercel-dev-api',
    apply: 'serve',
    configureServer(server) {
      for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
        process.env[key] ??= value;
      }
      for (const [route, { module, requiredEnv = [] }] of Object.entries(routes)) {
        server.middlewares.use(route, async (req, res, next) => {
          try {
            const missing = requiredEnv.filter((name) => !process.env[name]);
            if (missing.length > 0) {
              res.statusCode = 503;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: `Lokalnie ta funkcja wymaga w .env.local: ${missing.join(', ')}.` }));
              return;
            }
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const raw = Buffer.concat(chunks).toString('utf8');
            const isJson = req.headers['content-type']?.includes('application/json') === true;
            const vercelReq = Object.assign(req, { body: isJson && raw ? JSON.parse(raw) : raw || undefined });
            const vercelRes = Object.assign(res, {
              status(code: number) {
                res.statusCode = code;
                return vercelRes;
              },
              json(body: unknown) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(body));
                return vercelRes;
              },
            });
            const { default: handler } = await server.ssrLoadModule(module);
            await handler(vercelReq, vercelRes);
          } catch (err) {
            next(err);
          }
        });
      }
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

export default defineConfig(({ mode }) => ({
  server: {
    port: 8080,
    // Serwer dev uruchamia api/ z kluczem service_role z .env.local - domyślnie tylko localhost.
    // Dostęp z sieci (np. test na telefonie): VITE_DEV_HOST=0.0.0.0 (env procesu albo .env.local).
    host: loadEnv(mode, process.cwd(), 'VITE_').VITE_DEV_HOST?.trim() || 'localhost',
  },
  // Do bundla klienta trafiają VITE_* oraz publiczny site key Turnstile (TURNSTILE_KEY, Vercel env).
  // Nie dopisuj tu prefiksu 'TURNSTILE_' - wystawiłby sekret TURNSTILE_SECRET.
  envPrefix: ['VITE_', 'TURNSTILE_KEY'],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    react(),
    pdfjsAssets(),
    instanceHtml(appTitle(mode)),
    instanceCsp(mode),
    vercelDevApi(mode, {
      '/api/sejm-sittings': { module: '/api/sejm-sittings.ts' },
      '/api/poliai': { module: '/api/poliai.ts', requiredEnv: ['SUPABASE_SERVICE_ROLE_KEY'] },
      '/api/notifications': { module: '/api/notifications.ts', requiredEnv: ['SUPABASE_SERVICE_ROLE_KEY'] },
      '/api/integracje': { module: '/api/integracje.ts', requiredEnv: ['SUPABASE_SERVICE_ROLE_KEY'] },
    }),
    VitePWA({
      disable: mode === 'development',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon.svg'],
      manifest: {
        name: appTitle(mode),
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
        // Pliki pdf.js (dekodery skanów, fonty) pobierane tylko przy podglądzie PDF.
        globIgnores: ['pdfjs/**'],
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
}));

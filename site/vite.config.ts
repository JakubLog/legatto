import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build generatora strony posła (pnpm build:site):
//   1. klient:  vite build -c site/vite.config.ts
//      -> site/dist/client: _app/* (JS wysp, CSS Tailwind jak w SPA, fonty), .vite/manifest.json,
//         kopia public/ (logo, favicon, granice okręgów geo/, fonty newslettera fonts/newsletter/)
//   2. SSR:     vite build -c site/vite.config.ts --ssr site/render.tsx --outDir site/dist/server
//      -> site/dist/server/render.js (samowystarczalny: zależności w bundlu, obraz runtime nie ma node_modules)
// Bez PWA i service workera. Zasoby builda w /_app/ - /assets/ należy do zdjęć z migawki (sha256).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig(({ isSsrBuild }) => ({
  root: ROOT,
  base: '/',
  resolve: { alias: { '@': path.join(ROOT, 'src') } },
  plugins: [react()],
  publicDir: isSsrBuild ? false : path.join(ROOT, 'public'),
  // SSR bez zmiennych środowiska builda: produkcyjny React, żadnych adresów z .env w bundlu.
  envDir: path.join(ROOT, 'site'),
  envPrefix: 'LEGATTO_SITE_BUILD_',
  define: isSsrBuild ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  ssr: isSsrBuild ? { noExternal: true, target: 'node' } : undefined,
  build: isSsrBuild
    ? {
        outDir: path.join(ROOT, 'site/dist/server'),
        emptyOutDir: true,
        target: 'node22',
        minify: false,
        rollupOptions: { output: { format: 'es', entryFileNames: 'render.js', inlineDynamicImports: true } },
      }
    : {
        outDir: path.join(ROOT, 'site/dist/client'),
        emptyOutDir: true,
        manifest: true,
        assetsDir: '_app',
        // Bez data: URI (base64 mógłby przypadkiem zawierać wzorce strażnika zero-adres, np. „eyJ”).
        assetsInlineLimit: 0,
        modulePreload: { polyfill: false },
        sourcemap: false,
        rollupOptions: { input: path.join(ROOT, 'site/client.tsx') },
      },
}));

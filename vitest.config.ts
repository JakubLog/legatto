import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Osobna konfiguracja testów: bez wtyczek builda z vite.config.ts (PWA, CSP, serwer deweloperski).
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'build/**'],
  },
});

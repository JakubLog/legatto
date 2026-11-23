// Testy rozszerzenia .mcpb niezależne od konfiguracji Vite aplikacji:
//   node_modules/.bin/vitest run --config mcpb/vitest.config.mjs
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['test/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 20_000,
  },
});

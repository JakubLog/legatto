// `pg` to pakiet CommonJS wołający require() modułów wbudowanych (events, net...). W bundlu ESM
// (esbuild --format=esm) wywołania idą przez shim, który używa globalnego `require`, jeśli istnieje.
// Ten moduł musi być importowany przed `pg` (site/db.ts): ustawia `require` z createRequire, więc
// CLI działa także bez bannera createRequire z scripts/build-server.mjs.

import { createRequire } from 'node:module';

const scope = globalThis as { require?: NodeJS.Require };
scope.require ??= createRequire(import.meta.url);

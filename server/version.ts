// Wersja wydania (semver) wkompilowana przez scripts/build-server.mjs (esbuild define). Bez builda
// (vitest, serwer deweloperski Vite) - LEGATTO_VERSION albo wersja deweloperska.

declare const __LEGATTO_VERSION__: string | undefined;

export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/;

export const APP_VERSION: string =
  typeof __LEGATTO_VERSION__ === 'string' ? __LEGATTO_VERSION__ : process.env.LEGATTO_VERSION?.trim() || '0.0.0-dev';

// Flagi instancji ustawiane przez operatora w env wdrożenia (INSTANCE_AI, INSTANCE_EMAIL).
// Wstrzykiwane przy buildzie przez vite.config.ts (define __INSTANCE__) z parsera api/_lib/instance.ts.
// Ukrywają UI; serwer (api/) egzekwuje te same flagi niezależnie.
export const INSTANCE: Readonly<{ ai: boolean; email: boolean }> = __INSTANCE__;

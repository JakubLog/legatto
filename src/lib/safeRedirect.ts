// Cel przekierowania po zalogowaniu (`/login?redirect=...`): tylko ścieżka w tym samym
// originie. Odrzucamy `//host` i `/\host` (przeglądarka traktuje je jak adres innego hosta),
// adresy ze schematem, backslash oraz białe/kontrolne znaki (parser URL usuwa tab/LF,
// więc `/\t/host` stałby się `//host`). Na końcu sprawdzamy origin po sparsowaniu i ścieżkę
// po normalizacji (`/a/../..//host` daje `//host`).
export function safeRedirectPath(
  raw: string | null | undefined,
  origin: string = window.location.origin,
): string | null {
  // eslint-disable-next-line no-control-regex -- celowo wykrywamy znaki kontrolne
  if (!raw || raw[0] !== '/' || raw[1] === '/' || /[\\\s\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin || url.pathname.startsWith('//')) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

import { useSyncExternalStore } from 'react';

// To samo zapytanie co wariant Tailwinda `max-md:` - JS i CSS przełączają się na tej samej szerokości.
const MOBILE_QUERY = 'not all and (min-width: 768px)';

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

/** Czy ekran ma szerokość telefonu (poniżej breakpointu `md`). */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

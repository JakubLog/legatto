import type { KeyboardEvent } from 'react';

/**
 * Wartość klikalna w podglądzie sprawy (edycja w miejscu): bez ramki, tło dopiero po najechaniu.
 * Ujemny margines wyrównuje treść z etykietami mimo wewnętrznego odstępu.
 */
export const EDITABLE_VALUE =
  '-mx-2 inline-flex min-h-8 max-w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-muted max-md:min-h-10';

/** Kafelek klikalny do edycji (opis, notatki rozwiązania, osoba zgłaszająca). */
export const EDITABLE_TILE =
  'cursor-pointer rounded-lg transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

/** Pusty kafelek z akcją dodania (opis, osoba zgłaszająca, załączniki) - ta sama wysokość co wiersz załącznika. */
export const ADD_TILE =
  'flex min-h-10 w-full items-center gap-2 rounded-lg border border-dashed px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-60 max-md:min-h-11 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0';

/** Klik zakończony zaznaczeniem tekstu (kopiowanie fragmentu) nie otwiera edycji. */
export function selectingText(): boolean {
  return (window.getSelection()?.toString() ?? '').length > 0;
}

/** Enter/spacja na kafelku z role="button" - jak klik. */
export function activateOnKey(e: KeyboardEvent, action: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    action();
  }
}

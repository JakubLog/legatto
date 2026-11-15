/** Skrót klawiszowy panelu PoliAI do podpowiedzi (⌘J na macOS/iOS, Ctrl J gdzie indziej). */
export const POLIAI_SHORTCUT_LABEL =
  typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.userAgent) ? '⌘J' : 'Ctrl J';

/** Id pola wpisywania - fokus po otwarciu panelu. */
export const POLIAI_COMPOSER_ID = 'poliai-composer';

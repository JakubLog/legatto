// Ustawienia dostępności nakładane przed pierwszym malowaniem (bez mignięcia domyślnego wyglądu).
// Zwykły, synchroniczny skrypt w <head> - CSP `script-src 'self'` blokuje skrypty inline.
// Logika i nazwy muszą zgadzać się z src/lib/accessibility.ts (tam pełna obsługa i synchronizacja).
(function () {
  var root = document.documentElement;
  var s = null;
  try {
    s = JSON.parse(localStorage.getItem('app:a11y') || 'null');
  } catch (e) {
    s = null;
  }
  if (!s || typeof s !== 'object') s = {};
  var reduce =
    typeof s.reduceMotion === 'boolean'
      ? s.reduceMotion
      : window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (s.highContrast === true) root.classList.add('a11y-contrast');
  if (s.underlineLinks === true) root.classList.add('a11y-underline-links');
  if (s.strongFocus === true) root.classList.add('a11y-focus');
  if (s.readableSpacing === true) root.classList.add('a11y-spacing');
  if (s.colorBlind === true) root.classList.add('a11y-colorblind');
  if (reduce) root.classList.add('a11y-reduce-motion');
  if (s.textScale === 112 || s.textScale === 125 || s.textScale === 150) {
    root.setAttribute('data-a11y-text', String(s.textScale));
  }
})();

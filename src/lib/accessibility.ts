// Ustawienia dostępności - per urządzenie (localStorage), bez zapisu w bazie.
// Stosowane jako klasy / atrybut na <html>; style w bloku "Ustawienia dostępności" na końcu
// src/index.css. Przed pierwszym malowaniem te same klucze czyta public/a11y-init.js
// (zwykły skrypt w <head>, bo CSP `script-src 'self'` blokuje skrypty inline) - przy zmianie
// klucza, nazw klas albo wartości rozmiaru tekstu zaktualizuj oba pliki.

export const A11Y_STORAGE_KEY = 'app:a11y';
const CHANGE_EVENT = 'app:a11y-change';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Rozmiar tekstu w procentach rozmiaru bazowego przeglądarki (112 = 112,5%). */
export const TEXT_SCALES = [100, 112, 125, 150] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

export interface AccessibilitySettings {
  textScale: TextScale;
  highContrast: boolean;
  /** null = zgodnie z ustawieniem systemu (prefers-reduced-motion). */
  reduceMotion: boolean | null;
  underlineLinks: boolean;
  strongFocus: boolean;
  readableSpacing: boolean;
  /** Zieleń zastąpiona niebieskim (zaburzenia widzenia barw czerwono-zielonych). */
  colorBlind: boolean;
}

export const DEFAULT_A11Y_SETTINGS: AccessibilitySettings = {
  textScale: 100,
  highContrast: false,
  reduceMotion: null,
  underlineLinks: false,
  strongFocus: false,
  readableSpacing: false,
  colorBlind: false,
};

/** Klasy na <html> dla przełączników (wartość `true`). */
const CLASS_BY_FLAG = {
  highContrast: 'a11y-contrast',
  underlineLinks: 'a11y-underline-links',
  strongFocus: 'a11y-focus',
  readableSpacing: 'a11y-spacing',
  colorBlind: 'a11y-colorblind',
} as const;
const REDUCE_MOTION_CLASS = 'a11y-reduce-motion';
const TEXT_SCALE_ATTR = 'data-a11y-text';

export interface AccessibilityState {
  settings: AccessibilitySettings;
  /** Systemowe "ogranicz ruch" - dla opisu przy ustawieniu "zgodnie z systemem". */
  systemReducedMotion: boolean;
}

function parse(raw: string | null): AccessibilitySettings {
  if (!raw) return DEFAULT_A11Y_SETTINGS;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof AccessibilitySettings, unknown>>;
    return {
      textScale: TEXT_SCALES.includes(v.textScale as TextScale) ? (v.textScale as TextScale) : 100,
      highContrast: v.highContrast === true,
      reduceMotion: typeof v.reduceMotion === 'boolean' ? v.reduceMotion : null,
      underlineLinks: v.underlineLinks === true,
      strongFocus: v.strongFocus === true,
      readableSpacing: v.readableSpacing === true,
      colorBlind: v.colorBlind === true,
    };
  } catch {
    return DEFAULT_A11Y_SETTINGS;
  }
}

function readStorage(): AccessibilitySettings {
  try {
    return parse(localStorage.getItem(A11Y_STORAGE_KEY));
  } catch {
    return DEFAULT_A11Y_SETTINGS;
  }
}

function systemReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

let state: AccessibilityState = { settings: readStorage(), systemReducedMotion: systemReducedMotion() };

function applyToDocument({ settings, systemReducedMotion: systemReduce }: AccessibilityState): void {
  const root = document.documentElement;
  for (const [flag, cls] of Object.entries(CLASS_BY_FLAG) as [keyof typeof CLASS_BY_FLAG, string][]) {
    root.classList.toggle(cls, settings[flag]);
  }
  root.classList.toggle(REDUCE_MOTION_CLASS, settings.reduceMotion ?? systemReduce);
  if (settings.textScale === 100) root.removeAttribute(TEXT_SCALE_ATTR);
  else root.setAttribute(TEXT_SCALE_ATTR, String(settings.textScale));
}

function refresh(): void {
  state = { settings: readStorage(), systemReducedMotion: systemReducedMotion() };
  applyToDocument(state);
}

export function getAccessibilityState(): AccessibilityState {
  return state;
}

/** Wszystkie ustawienia domyślne - wtedy w localStorage nie zostaje żaden wpis. */
export function isDefaultAccessibility(settings: AccessibilitySettings): boolean {
  return (Object.keys(DEFAULT_A11Y_SETTINGS) as (keyof AccessibilitySettings)[]).every(
    (k) => settings[k] === DEFAULT_A11Y_SETTINGS[k],
  );
}

export function saveAccessibilitySettings(settings: AccessibilitySettings): void {
  try {
    if (isDefaultAccessibility(settings)) localStorage.removeItem(A11Y_STORAGE_KEY);
    else localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage niedostępny - ustawienia działają do przeładowania strony
  }
  state = { ...state, settings };
  applyToDocument(state);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Subskrypcja zmian: ta karta, inne karty (storage) i systemowe "ogranicz ruch". */
export function subscribeAccessibility(onChange: () => void): () => void {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  const onExternal = (e: Event) => {
    if (e instanceof StorageEvent && e.key !== null && e.key !== A11Y_STORAGE_KEY) return;
    refresh();
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onExternal);
  media.addEventListener('change', onExternal);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onExternal);
    media.removeEventListener('change', onExternal);
  };
}

/**
 * Start aplikacji: ponowne nałożenie ustawień (public/a11y-init.js robi to przed malowaniem)
 * i stała synchronizacja z innymi kartami oraz z systemowym "ogranicz ruch",
 * także gdy sekcja ustawień nie jest otwarta.
 */
export function initAccessibility(): void {
  applyToDocument(state);
  subscribeAccessibility(() => undefined);
}

import { SECTION_KEYS, type NewsletterTemplate, type SectionKey } from '@/lib/newsletter/types';

// ============================================================================
// Szkic newslettera w localStorage (per użytkownik) + ostatnio użyty układ sekcji.
// Szkic znika po udanej wysyłce; układ zapamiętujemy, żeby kolejne wydanie
// startowało z tymi samymi sekcjami (bez treści).
// ============================================================================

const DRAFT_PREFIX = 'app:newsletter-draft:v1:';
const LAYOUT_PREFIX = 'app:newsletter-layout:v1:';
/** Prefiks kluczy sprzed zmiany nazwy - niewysłany szkic nie może zniknąć przez samą aktualizację. */
const LEGACY_PREFIX = 'eposel:';

export interface StoredDraft {
  values: NewsletterTemplate;
  savedAt: string;
  /** Wydanie (newsletter_issues) utworzone przy wysyłce testowej - kolejne testy i wysyłka używają tego samego linku. */
  issueId: string | null;
}

const SECTION_KEY_LOOKUP: Record<string, true> = Object.fromEntries(SECTION_KEYS.map((k) => [k, true]));

function sanitizeSections(raw: unknown): SectionKey[] | null {
  if (!Array.isArray(raw)) return null;
  const valid = raw.filter((k): k is SectionKey => typeof k === 'string' && SECTION_KEY_LOOKUP[k] === true);
  return [...new Set(valid)];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Nakłada zapisaną treść (szkic albo zduplikowane wydanie) na aktualne wartości domyślne
 * (pole po polu, jeden poziom głębiej), żeby treść ze starszej wersji formularza nie zostawiła
 * brakujących pól. Typy niezgodne z domyślnymi są pomijane; resztę sprawdzi walidacja przed wysyłką.
 */
export function mergeTemplate(defaults: NewsletterTemplate, raw: unknown): NewsletterTemplate {
  if (!isPlainObject(raw)) return defaults;
  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, def] of Object.entries(defaults)) {
    const value = raw[key];
    if (key === 'sections') {
      merged.sections = sanitizeSections(value) ?? def;
    } else if (isPlainObject(def) && isPlainObject(value)) {
      const section: Record<string, unknown> = { ...def };
      for (const [field, fieldDef] of Object.entries(def)) {
        const fieldValue = value[field];
        if (fieldValue !== undefined && Array.isArray(fieldValue) === Array.isArray(fieldDef) && typeof fieldValue === typeof fieldDef) {
          section[field] = fieldValue;
        }
      }
      merged[key] = section;
    } else if (typeof value === typeof def) {
      merged[key] = value;
    }
  }
  return merged as NewsletterTemplate;
}

function readJson(key: string): unknown {
  try {
    let raw = localStorage.getItem(key);
    if (raw === null) {
      const legacyKey = LEGACY_PREFIX + key.slice('app:'.length);
      raw = localStorage.getItem(legacyKey);
      if (raw !== null) {
        localStorage.setItem(key, raw);
        localStorage.removeItem(legacyKey);
      }
    }
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Pełny storage / tryb prywatny - szkic po prostu się nie zapisze.
  }
}

export function loadDraft(userId: string, defaults: NewsletterTemplate): StoredDraft | null {
  const stored = readJson(DRAFT_PREFIX + userId);
  if (!isPlainObject(stored) || !isPlainObject(stored.values) || typeof stored.savedAt !== 'string') return null;
  return {
    values: mergeTemplate(defaults, stored.values),
    savedAt: stored.savedAt,
    issueId: typeof stored.issueId === 'string' ? stored.issueId : null,
  };
}

export function hasDraft(userId: string): boolean {
  return readJson(DRAFT_PREFIX + userId) !== null;
}

export function saveDraft(userId: string, values: NewsletterTemplate, issueId: string | null): string {
  const savedAt = new Date().toISOString();
  writeJson(DRAFT_PREFIX + userId, { values, savedAt, issueId });
  return savedAt;
}

export function clearDraft(userId: string) {
  try {
    localStorage.removeItem(DRAFT_PREFIX + userId);
  } catch {
    // brak dostępu do storage - nic do usunięcia
  }
}

/**
 * Usuwa z tego urządzenia szkice newslettera wszystkich kont (wołane przy wylogowaniu,
 * żeby treść niewysłanego wydania nie została na wspólnym komputerze). Układ sekcji
 * (bez treści) zostaje.
 */
export function clearNewsletterDrafts() {
  const legacyDraftPrefix = LEGACY_PREFIX + DRAFT_PREFIX.slice('app:'.length);
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(DRAFT_PREFIX) || key.startsWith(legacyDraftPrefix))) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // brak dostępu do storage - nic do usunięcia
  }
}

export function loadLayout(userId: string): SectionKey[] | null {
  const sections = sanitizeSections(readJson(LAYOUT_PREFIX + userId));
  return sections && sections.length > 0 ? sections : null;
}

export function saveLayout(userId: string, sections: SectionKey[]) {
  writeJson(LAYOUT_PREFIX + userId, sections);
}

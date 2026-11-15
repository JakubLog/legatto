// Stan blokady trybu prywatnego - trwaly (localStorage) i per-user, zeby
// nowa karta / restart PWA nie zdejmowaly zasloniecia ekranu.
// Weryfikacja PIN-u i limit prob sa po stronie DB (verify_my_privacy_pin).

const KEY_PREFIX = 'app:privacy:locked:';
const CHANGE_EVENT = 'app:privacy-lock-change';
/** Klucz sprzed zmiany nazwy - zablokowany ekran nie może się odblokować przez samą aktualizację. */
const LEGACY_KEY_PREFIX = 'eposel:privacy:locked:';

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function isPrivacyLocked(userId: string): boolean {
  try {
    const legacyKey = `${LEGACY_KEY_PREFIX}${userId}`;
    if (localStorage.getItem(legacyKey) === '1') {
      localStorage.setItem(storageKey(userId), '1');
      localStorage.removeItem(legacyKey);
    }
    return localStorage.getItem(storageKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function setPrivacyLocked(userId: string, locked: boolean): void {
  try {
    if (locked) localStorage.setItem(storageKey(userId), '1');
    else localStorage.removeItem(storageKey(userId));
  } catch {
    // localStorage niedostepny (tryb prywatny przegladarki) - ignoruj
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Subskrypcja zmian: ta karta (CHANGE_EVENT) + inne karty (storage). */
export function subscribePrivacyLock(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

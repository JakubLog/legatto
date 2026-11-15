import { SEARCH_RESULT_HREF, type SearchResultType } from '@/hooks/useGlobalSearch';

/** Ostatnio otwierane rekordy z wyszukiwarki (dane wewnętrzne biura - tylko id, typ, tytuł). */
export interface RecentRecord {
  type: SearchResultType;
  id: string;
  title: string;
}

const STORAGE_KEY = 'app.search.recent';
const MAX_RECENT = 8;

function isRecentRecord(value: unknown): value is RecentRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.type === 'string' &&
    Object.prototype.hasOwnProperty.call(SEARCH_RESULT_HREF, v.type)
  );
}

export function readRecent(): RecentRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isRecentRecord).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function pushRecent(record: RecentRecord): RecentRecord[] {
  const next = [
    { type: record.type, id: record.id, title: record.title },
    ...readRecent().filter((r) => !(r.type === record.type && r.id === record.id)),
  ].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // brak miejsca / tryb prywatny przeglądarki - pomijamy historię
  }
  return next;
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // jw.
  }
}

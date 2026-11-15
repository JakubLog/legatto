import { Briefcase, Calendar, FileText, UserRound, Wallet, type LucideIcon } from 'lucide-react';
import type { SearchResultType } from '@/hooks/useGlobalSearch';

/** Skrót klawiszowy wyszukiwarki do podpowiedzi (⌘K na macOS/iOS, Ctrl K gdzie indziej). */
export const SEARCH_SHORTCUT_LABEL =
  typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.userAgent)
    ? '⌘K'
    : 'Ctrl K';

/** Kolejność grup wyników w palecie. */
export const RESULT_TYPES: SearchResultType[] = ['case', 'contact', 'event', 'interpellation', 'expense'];

export const RESULT_TYPE_META: Record<SearchResultType, { group: string; label: string; Icon: LucideIcon }> = {
  case: { group: 'Sprawy', label: 'Sprawa', Icon: Briefcase },
  contact: { group: 'Kontakty', label: 'Kontakt', Icon: UserRound },
  event: { group: 'Wydarzenia', label: 'Wydarzenie', Icon: Calendar },
  interpellation: { group: 'Interpelacje', label: 'Interpelacja', Icon: FileText },
  expense: { group: 'Wydatki', label: 'Wydatek', Icon: Wallet },
};

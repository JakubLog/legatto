import type { InterpellationListItem } from '@/integrations/supabase/types';

export interface RecipientGroup<T> {
  /** Klucz porównania: bez spacji na brzegach i bez rozróżniania wielkości liter. */
  key: string;
  /** Pisownia z pierwszej interpelacji w grupie. */
  label: string;
  items: T[];
}

/** "Minister Zdrowia" i " minister zdrowia" to ten sam odbiorca. */
export const recipientKey = (recipient: string) => recipient.trim().toLocaleLowerCase('pl');

/** Grupy wg odbiorcy: najliczniejsze najpierw, przy remisie alfabetycznie. Kolejność w grupie zachowana. */
export function groupByRecipient<T extends Pick<InterpellationListItem, 'recipient'>>(
  items: readonly T[],
): RecipientGroup<T>[] {
  const groups = new Map<string, RecipientGroup<T>>();
  for (const it of items) {
    const key = recipientKey(it.recipient);
    const group = groups.get(key);
    if (group) group.items.push(it);
    else groups.set(key, { key, label: it.recipient.trim(), items: [it] });
  }
  return [...groups.values()].sort(
    (a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label, 'pl'),
  );
}

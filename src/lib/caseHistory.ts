import { format, isToday, isYesterday } from 'date-fns';
import { pl } from 'date-fns/locale';
import { CASE_PRIORITY_LABELS, CASE_STATUS_LABELS } from '@/lib/cases';
import type { CaseActivity, CasePriority, CaseStatus } from '@/integrations/supabase/types';

export const CASE_COMMENT_MAX = 4000;

/**
 * Opis wpisu dziennika. Płeć autora nie jest znana, więc formy bezosobowe
 * („Utworzono sprawę”, „Status: Nowa → W toku”), a autor i czas w osobnej linii.
 */
export function describeCaseActivity(a: CaseActivity): { text: string; detail?: string } {
  const d = a.data ?? {};
  const none = 'brak';
  switch (a.kind) {
    case 'created':
      return { text: d.source === 'public_form' ? 'Zgłoszenie z formularza publicznego' : 'Utworzono sprawę' };
    case 'status':
      return {
        text: `Status: ${CASE_STATUS_LABELS[d.from as CaseStatus] ?? d.from ?? none} → ${CASE_STATUS_LABELS[d.to as CaseStatus] ?? d.to ?? none}`,
      };
    case 'priority':
      return {
        text: `Priorytet: ${CASE_PRIORITY_LABELS[d.from as CasePriority] ?? d.from ?? none} → ${CASE_PRIORITY_LABELS[d.to as CasePriority] ?? d.to ?? none}`,
      };
    case 'assigned':
      return {
        text: `Przypisanie: ${d.from ? (d.from_name ?? 'usunięte konto') : none} → ${d.to ? (d.to_name ?? 'usunięte konto') : none}`,
      };
    case 'due_date': {
      const fmt = (v: string | null | undefined) => (v ? format(new Date(`${v}T00:00:00`), 'd MMM yyyy', { locale: pl }) : none);
      return { text: `Termin: ${fmt(d.from)} → ${fmt(d.to)}` };
    }
    case 'category':
      return {
        text: `Kategoria: ${d.from ? (d.from_name ?? 'usunięta') : none} → ${d.to ? (d.to_name ?? 'usunięta') : none}`,
      };
    case 'title':
      return { text: 'Zmieniono tytuł', detail: d.to ?? undefined };
    case 'description':
      return { text: 'Zmieniono opis sprawy' };
    case 'attachment_added':
      return { text: 'Dodano załącznik', detail: d.filename ?? undefined };
    case 'attachment_removed':
      return { text: 'Usunięto załącznik', detail: d.filename ?? undefined };
    default:
      return { text: 'Zmiana w sprawie' };
  }
}

/** Nagłówek dnia na osi czasu. */
export function timelineDayLabel(date: Date): string {
  if (isToday(date)) return 'Dziś';
  if (isYesterday(date)) return 'Wczoraj';
  return format(date, 'd MMMM yyyy', { locale: pl });
}

/** Porównanie bez wielkości liter i polskich znaków (filtr wzmianek). */
export function foldForSearch(value: string): string {
  return value.toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
}

/**
 * Aktywna wzmianka przed kursorem: `@` na początku tekstu albo po białym znaku,
 * dalej najwyżej 3 słowa bez nowej linii (imię i nazwisko ze spacją).
 */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n\r@]|\s{2}|^\s/.test(query) || query.split(' ').length > 3) return null;
  return { start: at, query };
}

/** Podział treści komentarza na tekst i podświetlone `@Imię Nazwisko` wzmiankowanych osób. */
export function splitMentions(body: string, names: string[]): Array<{ text: string; mention: boolean }> {
  const unique = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (unique.length === 0) return [{ text: body, mention: false }];
  const pattern = new RegExp(`@(?:${unique.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  const parts: Array<{ text: string; mention: boolean }> = [];
  let last = 0;
  for (const m of body.matchAll(pattern)) {
    const index = m.index ?? 0;
    if (index > last) parts.push({ text: body.slice(last, index), mention: false });
    parts.push({ text: m[0], mention: true });
    last = index + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), mention: false });
  return parts;
}

import { NEWSLETTER_CRITICAL_DAYS, NEWSLETTER_WARNING_DAYS } from '@/lib/moduleOwners';
import type { PulseLevel } from '@/integrations/supabase/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimalny kształt newslettera z GetResponse API v3 (`GET /newsletters`). */
export interface GrNewsletterLike {
  newsletterId: string;
  name?: string;
  subject?: string;
  status?: string;
  sendOn?: string;
  sendMetrics?: { status?: string };
}

/** Wydanie wysłane z aplikacji (`newsletter_issues`, status 'sent'). */
export interface SentIssueLike {
  gr_newsletter_id: string | null;
  sent_at: string | null;
}

export interface NewsletterSends {
  level: PulseLevel;
  reason: string | null;
  sentLast14Days: number;
}

const FAILED_STATUSES = new Set(['draft', 'failed', 'error', 'canceled', 'cancelled']);
const TEST_PREFIX = '[TEST]';

/**
 * Czy newsletter z GR został faktycznie wysłany. GR v3 nie zwraca statusu 'sent':
 * `status` newslettera to stan zasobu (np. 'enabled'), a postęp wysyłki jest w
 * `sendMetrics.status` ('scheduled' | 'in_progress' | 'finished'). Bez sendMetrics
 * wysłany = `sendOn` w przeszłości. Wysyłki testowe (prefiks [TEST]) pomijamy.
 */
export function isGrNewsletterSent(n: GrNewsletterLike, now: number): boolean {
  if (n.name?.startsWith(TEST_PREFIX) || n.subject?.startsWith(TEST_PREFIX)) return false;
  if (FAILED_STATUSES.has((n.status ?? '').toLowerCase())) return false;
  const metrics = n.sendMetrics?.status?.toLowerCase();
  if (metrics) return metrics === 'finished' || metrics === 'in_progress';
  const time = n.sendOn ? new Date(n.sendOn).getTime() : Number.NaN;
  return !Number.isNaN(time) && time <= now;
}

/**
 * Ocena reguły "wysyłka co tydzień" z obu źródeł: historii GR (także wysyłki zrobione
 * bezpośrednio w GetResponse) i wydań wysłanych z aplikacji. Ta sama wysyłka w obu
 * źródłach (gr_newsletter_id) liczona raz. `null` = żadne źródło niedostępne.
 */
export function evaluateNewsletterSends(
  grNewsletters: GrNewsletterLike[] | undefined,
  issues: SentIssueLike[] | undefined,
  now: number,
): NewsletterSends | null {
  if (!grNewsletters && !issues) return null;

  const sends = new Map<string, number>();
  for (const n of grNewsletters ?? []) {
    if (!isGrNewsletterSent(n, now)) continue;
    const time = n.sendOn ? new Date(n.sendOn).getTime() : Number.NaN;
    if (!Number.isNaN(time)) sends.set(`gr:${n.newsletterId}`, time);
  }
  for (const issue of issues ?? []) {
    const time = issue.sent_at ? new Date(issue.sent_at).getTime() : Number.NaN;
    if (Number.isNaN(time)) continue;
    const key = issue.gr_newsletter_id ? `gr:${issue.gr_newsletter_id}` : `issue:${issue.sent_at}`;
    // Wysyłka w GR może mieć sendOn = null tuż po utworzeniu - wtedy bierzemy sent_at.
    if (!sends.has(key)) sends.set(key, time);
  }

  const times = [...sends.values()];
  const days = times.length > 0 ? Math.floor((now - Math.max(...times)) / DAY_MS) : null;
  const level: PulseLevel =
    days === null || days > NEWSLETTER_CRITICAL_DAYS
      ? 'critical'
      : days > NEWSLETTER_WARNING_DAYS
        ? 'warning'
        : 'ok';
  return {
    level,
    reason:
      level === 'ok'
        ? null
        : days === null
          ? 'Brak wysłanych newsletterów'
          : `Ostatnia wysyłka ${days} dni temu (cel: co tydzień)`,
    sentLast14Days: times.filter((t) => now - t <= 14 * DAY_MS).length,
  };
}

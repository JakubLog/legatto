// Wszystkie crony w jednej funkcji (limit liczby funkcji na planie Vercel Hobby):
//   /api/cron/sync-ics       synchronizacja kalendarzy ICS
//   /api/cron/poliai-purge   retencja PoliAI, sprzątanie plików, stare sesje
//   /api/cron/notifications  powiadomienia dzienne/tygodniowe + wysyłka kolejki
// Autoryzacja: nagłówek `Authorization: Bearer ${CRON_SECRET}` (ustawia Vercel Cron).
import { createHash, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runNotifications } from '../_lib/cron/notifications.js';
import { runPurge } from '../_lib/cron/purge.js';
import { runSyncIcs } from '../_lib/cron/syncIcs.js';
import type { CronJobResult } from '../_lib/cron/types.js';

const JOBS: Record<string, () => Promise<CronJobResult>> = {
  'sync-ics': runSyncIcs,
  'poliai-purge': runPurge,
  notifications: runNotifications,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Nazwa zadania przed autoryzacją: nazwy są jawne (vercel.json), a 404 dla nieznanej ścieżki
  // pozwala sprawdzić routing bez sekretu.
  const job = typeof req.query.job === 'string' ? req.query.job : '';
  const run = Object.hasOwn(JOBS, job) ? JOBS[job] : undefined;
  if (!run) return res.status(404).json({ error: 'Unknown cron job' });
  const secret = process.env.CRON_SECRET;
  // Porownanie w stalym czasie na skrotach SHA-256 (rowna dlugosc, brak wycieku dlugosci sekretu).
  const provided = createHash('sha256').update(req.headers.authorization ?? '').digest();
  const expected = createHash('sha256').update(`Bearer ${secret ?? ''}`).digest();
  if (!secret || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const result = await run();
  return res.status(result.status).json(result.body);
}

// Cron (codziennie): usuwa rozmowy PoliAI bez aktywnosci od 90 dni (retencja danych wyborcow)
// i niewyslane zalaczniki starsze niz 1 dzien, a potem pliki bez wiersza w bazie (Storage API -
// SQL nie usuwa plikow z magazynu): bucket poliai-attachments bez wiersza w poliai_attachments,
// receipts bez wydatku (pliki z upload_url MCP nigdy niepodpiete, porzucone formularze),
// case-attachments bez wiersza w case_attachments (usuniete sprawy, nieudany zapis wiersza)
// i avatars bez profilu wskazujacego plik (podmienione/usuniete zdjecia, usuniete konta).
// Dokumenty do podpisu: wiersze plikow dokumentow anulowanych ponad 30 dni temu (signing_purge_cancelled),
// potem obiekty signing-documents bez wiersza w bazie.
// Sesje Supabase Auth po limicie życia (30 dni) albo bezczynności (7 dni): service_purge_stale_sessions.
// Zadanie poliai-purge w api/cron/[job].ts (jedna funkcja cronów - limit funkcji Vercel Hobby).
import { getServiceClient } from '../supabase.js';
import { errorSummary } from '../log-safe.js';
import type { CronJobResult } from './types.js';

const ORPHAN_BATCH = 1000;
const REMOVE_CHUNK = 100;
// Bezpiecznik petli: 50 x 1000 plikow na bucket na jedno uruchomienie, reszta przy nastepnym.
const MAX_ORPHAN_BATCHES = 50;

const ORPHAN_SOURCES = [
  { bucket: 'poliai-attachments', rpc: 'poliai_orphan_attachment_objects' },
  { bucket: 'receipts', rpc: 'receipts_orphan_objects' },
  { bucket: 'case-attachments', rpc: 'case_attachments_orphan_objects' },
  { bucket: 'avatars', rpc: 'avatars_orphan_objects' },
  { bucket: 'signing-documents', rpc: 'signing_orphan_objects' },
] as const;

/** Usuwa pliki zwracane przez `rpc` (nazwy obiektow bez wiersza w bazie); null = blad. */
async function removeOrphans(bucket: string, rpc: string): Promise<number | null> {
  const supabase = getServiceClient();
  let removedFiles = 0;
  for (let batch = 0; batch < MAX_ORPHAN_BATCHES; batch++) {
    const orphans = await supabase.rpc(rpc, { max_rows: ORPHAN_BATCH });
    if (orphans.error) {
      console.error(`[poliai-purge] ${bucket} orphan list error`, errorSummary(orphans.error));
      return null;
    }
    const names = (orphans.data ?? []) as string[];
    for (let i = 0; i < names.length; i += REMOVE_CHUNK) {
      const chunk = names.slice(i, i + REMOVE_CHUNK);
      const removed = await supabase.storage.from(bucket).remove(chunk);
      if (removed.error) {
        console.error(`[poliai-purge] ${bucket} storage remove error`, errorSummary(removed.error));
        return null;
      }
      removedFiles += chunk.length;
    }
    if (names.length < ORPHAN_BATCH) break;
  }
  return removedFiles;
}

export async function runPurge(): Promise<CronJobResult> {
  // Kroki niezalezne: blad jednego (retencja PoliAI, sprzatanie bucketu) nie blokuje pozostalych.
  const { data, error } = await getServiceClient().rpc('purge_expired_poliai_conversations');
  if (error) console.error('[poliai-purge] error', errorSummary(error));
  // Limit życia sesji na planie Free (brak sessions_timebox): sesje starsze niż 30 dni albo bez
  // aktywności od 7 dni razem z refresh tokenami. Bramka is_aal2() i tak je odrzuca, więc błąd
  // tylko logujemy - nie oznacza nieudanego sprzątania.
  const sessions = await getServiceClient().rpc('service_purge_stale_sessions');
  if (sessions.error) console.error('[poliai-purge] service_purge_stale_sessions error', errorSummary(sessions.error));
  // Najpierw wiersze plikow anulowanych dokumentow - ich obiekty staja sie sierotami ponizej.
  const cancelled = await getServiceClient().rpc('signing_purge_cancelled');
  if (cancelled.error) console.error('[poliai-purge] signing_purge_cancelled error', errorSummary(cancelled.error));
  const removedFiles: Record<string, number | null> = {};
  for (const { bucket, rpc } of ORPHAN_SOURCES) {
    removedFiles[bucket] = await removeOrphans(bucket, rpc);
  }
  const failed = Boolean(error) || Boolean(cancelled.error) || Object.values(removedFiles).includes(null);
  return {
    status: failed ? 500 : 200,
    body: {
      deleted: error ? null : data,
      removed_files: removedFiles,
      signing_cancelled_files: cancelled.error ? null : cancelled.data,
      stale_sessions: sessions.error ? null : sessions.data,
      ...(failed && { error: 'Purge failed' }),
    },
  };
}

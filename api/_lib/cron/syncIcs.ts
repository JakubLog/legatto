// Cron sync-ics (codziennie): synchronizacja aktywnych źródeł ICS. Liczba źródeł ograniczona
// w bazie (ics_sources_guard), pobieranie po kilka naraz - bez szczytu pamięci i transferu.
import { instanceFlags } from '../instance.js';
import { getServiceClient } from '../supabase.js';
import { errorSummary } from '../log-safe.js';
import { syncSource, type SyncResult } from '../ics-sync.js';
import type { CronJobResult } from './types.js';

const CONCURRENCY = 4;

export async function runSyncIcs(): Promise<CronJobResult> {
  // INSTANCE_ICS=off: bez pobierania (na VPS egress i tak by je odrzucił).
  if (!instanceFlags().ics) return { status: 200, body: { synced: 0, disabled: true } };
  const supabase = getServiceClient();

  const { data: sources, error } = await supabase
    .from('ics_sources')
    .select('id, created_by')
    .eq('is_active', true);

  if (error) {
    console.error('[cron sync-ics] list sources error', errorSummary(error));
    return { status: 500, body: { error: 'Failed to list sources' } };
  }

  if (!sources || sources.length === 0) {
    return { status: 200, body: { synced: 0, results: [] } };
  }

  const results: SyncResult[] = [];
  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(batch.map((src) => syncSource(src.id as string, src.created_by as string)))));
  }

  const totalImported = results.reduce((sum, r) => sum + r.imported, 0);

  return { status: 200, body: { synced: sources.length, totalImported, results } };
}

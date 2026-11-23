// legatto-intake fetch (R9): proces z siecią i tokenem kolejki, BEZ klucza formularza i BEZ bazy.
// 1. Wysyła do kolejki decyzje z acks/ (ack po zapisie w bazie albo kwarantannie, retry po błędzie
//    przejściowym); usuwa wpis po sukcesie albo gdy Cloudflare uznał dzierżawę za nieważną.
// 2. Pobiera nowe wiadomości (forms, potem DLQ) i zapisuje je do inbox/ (szyfrogramy, nieczytelne
//    bez klucza). Ponowne doręczenie wiadomości, która już czeka w inbox/ albo acks/, tylko
//    odświeża lease_id, żeby ack użył aktualnej dzierżawy.

import type { QueueClient } from './queue';
import type { AckRecord, InboxMessage, QueueName, Spool } from './spool';
import { isSafeMessageId } from './spool';

export interface FetchOptions {
  queues: Partial<Record<QueueName, string>>;
  batchSize: number;
  visibilityTimeoutMs: number;
  retryDelaySeconds: number;
  /** Maks. liczba pull na kolejkę w jednym przebiegu (ogranicza czas działania). */
  maxBatches: number;
}

export interface FetchSummary {
  ok: boolean;
  acked: number;
  retried: number;
  ack_pending: number;
  pulled: number;
  refreshed: number;
  backlog: number | null;
}

const QUEUE_ORDER: QueueName[] = ['forms', 'dlq'];

export async function runFetch(spool: Spool, queue: QueueClient, options: FetchOptions): Promise<FetchSummary> {
  const summary: FetchSummary = { ok: true, acked: 0, retried: 0, ack_pending: 0, pulled: 0, refreshed: 0, backlog: null };

  // 1. Ack/retry z acks/.
  const records = spool.list(spool.acks).map((id) => spool.readJson<AckRecord>(spool.acks, id));
  for (const name of QUEUE_ORDER) {
    const queueId = options.queues[name];
    const pending = records.filter((r) => r.queue === name);
    if (!queueId || pending.length === 0) continue;
    for (let i = 0; i < pending.length; i += 100) {
      const batch = pending.slice(i, i + 100);
      const acks = batch.filter((r) => r.action === 'ack').map((r) => r.lease_id);
      const retries = batch
        .filter((r) => r.action === 'retry')
        .map((r) => ({ lease_id: r.lease_id, delay_seconds: options.retryDelaySeconds }));
      const result = await queue.ack(queueId, acks, retries);
      if (result.ok) {
        for (const r of batch) spool.remove(spool.acks, r.msg_id);
        summary.acked += acks.length;
        summary.retried += retries.length;
        continue;
      }
      // Partia odrzucona: pojedynczo, żeby jedna wygasła dzierżawa nie blokowała reszty.
      for (const r of batch) {
        const single =
          r.action === 'ack'
            ? await queue.ack(queueId, [r.lease_id], [])
            : await queue.ack(queueId, [], [{ lease_id: r.lease_id, delay_seconds: options.retryDelaySeconds }]);
        if (single.ok || single.leaseInvalid) {
          spool.remove(spool.acks, r.msg_id);
          if (single.ok && r.action === 'ack') summary.acked += 1;
          if (single.ok && r.action === 'retry') summary.retried += 1;
        } else {
          summary.ack_pending += 1;
          summary.ok = false;
        }
      }
    }
  }

  // 2. Pull.
  for (const name of QUEUE_ORDER) {
    const queueId = options.queues[name];
    if (!queueId) continue;
    for (let n = 0; n < options.maxBatches; n++) {
      const result = await queue.pull(queueId, options.batchSize, options.visibilityTimeoutMs);
      if (name === 'forms') summary.backlog = result.backlog;
      for (const m of result.messages) {
        if (!isSafeMessageId(m.id)) {
          summary.ok = false;
          process.stderr.write('fetch: pominięto wiadomość z niebezpiecznym identyfikatorem\n');
          continue;
        }
        if (spool.exists(spool.acks, m.id)) {
          const rec = spool.readJson<AckRecord>(spool.acks, m.id);
          spool.writeAtomic(spool.acks, m.id, JSON.stringify({ ...rec, lease_id: m.lease_id }));
          summary.refreshed += 1;
          continue;
        }
        if (spool.exists(spool.inbox, m.id)) {
          const msg = spool.readJson<InboxMessage>(spool.inbox, m.id);
          spool.writeAtomic(spool.inbox, m.id, JSON.stringify({ ...msg, lease_id: m.lease_id, attempts: m.attempts }));
          summary.refreshed += 1;
          continue;
        }
        const record: InboxMessage = {
          v: 1,
          queue: name,
          msg_id: m.id,
          lease_id: m.lease_id,
          attempts: m.attempts,
          timestamp_ms: m.timestamp_ms,
          body_b64: m.body,
        };
        spool.writeAtomic(spool.inbox, m.id, JSON.stringify(record));
        summary.pulled += 1;
      }
      if (result.messages.length < options.batchSize) break;
    }
  }
  return summary;
}

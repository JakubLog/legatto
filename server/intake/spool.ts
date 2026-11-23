// Katalogi wymiany intake (montowane z hosta, `/var/lib/legatto/intake`):
//   inbox/<msg_id>.json      - wiadomości z kolejki (fetch zapisuje, process czyta i usuwa)
//   acks/<msg_id>.json       - decyzje process (ack|retry), fetch wysyła je do kolejki i usuwa
//   quarantine/<msg_id>.bin  - surowa koperta odrzucona przed deszyfracją/po błędzie kryptografii
//   quarantine/<msg_id>.json - powód kwarantanny
// Zapis atomowy: <plik>.tmp-<pid> (0600) → fsync → rename. Nazwy plików tylko z bezpiecznych znaków.

import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

export interface InboxMessage {
  v: 1;
  queue: QueueName;
  msg_id: string;
  lease_id: string;
  attempts: number;
  timestamp_ms: number;
  body_b64: string;
}

export type QueueName = 'forms' | 'dlq';

export type AckOutcome =
  | 'inserted'
  | 'duplicate'
  | 'rejected_validation'
  | 'rejected_ratelimit'
  | 'quarantined'
  | 'selftest';

export interface AckRecord {
  v: 1;
  queue: QueueName;
  msg_id: string;
  lease_id: string;
  action: 'ack' | 'retry';
  outcome: AckOutcome | 'error';
}

const MSG_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function isSafeMessageId(id: string): boolean {
  return MSG_ID_RE.test(id);
}

export class Spool {
  readonly inbox: string;
  readonly acks: string;
  readonly quarantine: string;

  constructor(root: string) {
    this.inbox = join(root, 'inbox');
    this.acks = join(root, 'acks');
    this.quarantine = join(root, 'quarantine');
  }

  /** Pliki <msg_id>.json w katalogu (bez plików tymczasowych), posortowane. */
  list(dir: string): string[] {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json') && isSafeMessageId(name.slice(0, -5)))
      .map((name) => name.slice(0, -5))
      .sort();
  }

  path(dir: string, msgId: string, ext = '.json'): string {
    if (!isSafeMessageId(msgId)) throw new Error(`niebezpieczny identyfikator wiadomości: ${msgId}`);
    return join(dir, `${msgId}${ext}`);
  }

  exists(dir: string, msgId: string): boolean {
    return existsSync(this.path(dir, msgId));
  }

  readJson<T>(dir: string, msgId: string): T {
    return JSON.parse(readFileSync(this.path(dir, msgId), 'utf8')) as T;
  }

  writeAtomic(dir: string, msgId: string, data: string | Uint8Array, ext = '.json'): void {
    const target = this.path(dir, msgId, ext);
    const tmp = `${target}.tmp-${process.pid}`;
    const fd = openSync(tmp, 'w', 0o600);
    try {
      writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, target);
  }

  remove(dir: string, msgId: string, ext = '.json'): void {
    rmSync(this.path(dir, msgId, ext), { force: true });
  }
}

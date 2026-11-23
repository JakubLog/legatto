// Połączenie z bazą jako rola legatto_publisher (EXECUTE tylko service_site_publisher_claim/finish
// i service_site_snapshot). Sieć: legatto-int (tylko db). Hasło z credentials systemd, nigdy z env.

import { readFileSync } from 'node:fs';
import './nodeRequire';
import pg from 'pg';
import { ConfigError } from './build';

export const DEFAULT_DB_PASSWORD_FILE = '/run/credentials/legatto-db-publisher';

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export interface PublisherDb {
  claim(): Promise<{ job: string | null; reason: string | null }>;
  snapshot(): Promise<unknown>;
  finish(job: string, status: 'ok' | 'failed', deploymentId: string | null, error: string | null): Promise<void>;
  close(): Promise<void>;
}

export async function connectPublisherDb(): Promise<PublisherDb> {
  const passwordFile = env('LEGATTO_DB_PASSWORD_FILE', DEFAULT_DB_PASSWORD_FILE);
  let password: string;
  try {
    password = readFileSync(passwordFile, 'utf8').trim();
  } catch {
    throw new ConfigError(`nie można odczytać pliku hasła bazy ${passwordFile}`);
  }
  if (!password) throw new ConfigError(`pusty plik hasła bazy ${passwordFile}`);

  const client = new pg.Client({
    host: env('PGHOST', 'db'),
    port: Number(env('PGPORT', '5432')),
    database: env('PGDATABASE', 'postgres'),
    user: env('PGUSER', 'legatto_publisher'),
    password,
    application_name: 'legatto-site-publisher',
    statement_timeout: 60_000,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  return {
    async claim() {
      const res = await client.query<{ job_id: string | null; reason: string | null }>(
        'select job_id, reason from public.service_site_publisher_claim()',
      );
      const row = res.rows[0];
      return row?.job_id ? { job: row.job_id, reason: row.reason } : { job: null, reason: null };
    },
    async snapshot() {
      const res = await client.query<{ snapshot: unknown }>('select public.service_site_snapshot() as snapshot');
      return res.rows[0]?.snapshot ?? null;
    },
    async finish(job, status, deploymentId, error) {
      await client.query('select public.service_site_publisher_finish($1::uuid, $2::text, $3::text, $4::text)', [
        job,
        status,
        deploymentId,
        error,
      ]);
    },
    close: () => client.end(),
  };
}

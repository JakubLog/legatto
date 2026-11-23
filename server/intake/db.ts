// Połączenie z bazą jako rola legatto_intake (EXECUTE tylko intake.submit_public_case).
// Sieć: legatto-int (tylko db). Hasło z credentials systemd, nigdy z env.

import pg from 'pg';
import { DEFAULTS, env, readSecretFile } from './config';
import type { SubmitFn } from './process';

export async function connectIntakeDb(): Promise<{ submit: SubmitFn; close: () => Promise<void> }> {
  const client = new pg.Client({
    host: env('PGHOST', 'db'),
    port: Number(env('PGPORT', '5432')),
    database: env('PGDATABASE', 'postgres'),
    user: env('PGUSER', 'legatto_intake'),
    password: readSecretFile(env('LEGATTO_DB_PASSWORD_FILE', DEFAULTS.dbPasswordFile)),
    application_name: 'legatto-intake-process',
    statement_timeout: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  return {
    submit: async (payload) => {
      const res = await client.query<{ outcome: string }>('select intake.submit_public_case($1::jsonb) as outcome', [
        JSON.stringify(payload),
      ]);
      return res.rows[0]?.outcome ?? '';
    },
    close: () => client.end(),
  };
}

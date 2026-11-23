// legatto site - generator statycznej strony posła w obrazie `app` (`node /app/server/site.mjs <komenda>`).
// Uruchamia go site-publisher (legatto-infra) w osobnych kontenerach (`--user 65532 --read-only
// --tmpfs /tmp`): claim/snapshot/finish w sieci legatto-int (tylko db + Storage), build z
// `--network none`. Kontrakt: interfejs app↔publicsite §6.
//
// Decyzja (zamiast Astro z projektu phase0): strona = istniejące komponenty publiczne React
// (src/components/public/*) renderowane SSR przez react-dom/server (site/render.tsx), interaktywne
// części (menu, kalendarz z posiedzeniami Sejmu z /api/sejm-sittings Workera, okno zespołu biura,
// formularz zgłoszeń) jako wyspy hydratowane w przeglądarce (site/islands.tsx, site/client.tsx).
// Build Vite tym samym toolchainem i Tailwindem co SPA (site/vite.config.ts, `pnpm build:site`):
// klient -> site/dist/client (z manifestem), SSR -> site/dist/server/render.js. Powody:
//   - jeden framework i jeden toolchain - bez Astro i jego zależności w repo i w obrazie runtime,
//   - wygląd strony = podgląd w CRM (te same komponenty i CSS), bez drugiej implementacji,
//   - render to czysta funkcja migawka -> HTML, więc build działa bez sieci i bez node_modules
//     (render.js samowystarczalny, ten CLI bundlowany esbuildem do server/site.mjs).
//
// Komendy:
//   claim                                             zajęcie joba publikacji -> {"job","reason"}
//   snapshot --out DIR [--storage-url URL]            DIR/snapshot.json + DIR/assets/<sha256>.<ext>
//   build --snapshot DIR --site-config FILE --out DIST [--deny-host H]...
//                                                     strona statyczna + strażnik zero-adres
//   finish --job UUID --status ok|failed [--deployment-id ID] [--error CODE]
// Wynik: jeden obiekt JSON na stdout; komunikaty na stderr; nigdy sekrety.
// Kody wyjścia: 0 OK, 1 błąd, 2 błędne argumenty, 4 konfiguracja, 20 strażnik zero-adres.
// Baza: PGHOST (db), PGPORT (5432), PGDATABASE (postgres), PGUSER (legatto_publisher),
// hasło z pliku LEGATTO_DB_PASSWORD_FILE (/run/credentials/legatto-db-publisher).
// Build: LEGATTO_SITE_DIST (domyślnie <katalog CLI>/../site/dist: client/ i server/render.js).

import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { siteSnapshotSchema } from '../src/lib/siteSnapshot';
import { BuildError, buildSite, ConfigError, loadSiteConfig, type RenderModule } from './build';
import { connectPublisherDb, type PublisherDb } from './db';
import { nodeStorageFetch, prepareSnapshot, StorageError, writeSnapshotFile } from './snapshot';

export const EXIT = { ok: 0, error: 1, usage: 2, config: 4, guard: 20 } as const;

export const DEFAULT_STORAGE_URL = 'http://api-gw:8000';

const USAGE = `Użycie: site.mjs <claim|snapshot|build|finish> [opcje]
  claim
  snapshot --out DIR [--storage-url ${DEFAULT_STORAGE_URL}]
  build --snapshot DIR --site-config FILE --out DIST [--deny-host HOST]...
  finish --job UUID --status ok|failed [--deployment-id ID] [--error CODE]`;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Połączenie z bazą (test seam). */
  connectDb: () => Promise<PublisherDb>;
  /** Moduł SSR z LEGATTO_SITE_DIST (test seam). */
  loadRender: (distDir: string) => Promise<RenderModule>;
  env: NodeJS.ProcessEnv;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEPLOYMENT_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ERROR_CODE_RE = /^[a-z0-9_.:-]{1,64}$/;

/** Błąd parseArgs (nieznana opcja, brak wartości) -> UsageError (kod 2). */
function usage<T>(parse: () => T): T {
  try {
    return parse();
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
}

function required(value: string | undefined, flag: string, command: string): string {
  if (!value) throw new UsageError(`${command}: wymagane ${flag}`);
  return value;
}

/** Domyślny katalog builda strony: obok CLI w obrazie (/app/server/site.mjs -> /app/site/dist). */
export function defaultSiteDist(env: NodeJS.ProcessEnv): string {
  return env.LEGATTO_SITE_DIST?.trim() || resolve(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'dist');
}

async function withDb<T>(io: CliIo, fn: (db: PublisherDb) => Promise<T>): Promise<T> {
  const db = await io.connectDb();
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

async function cmdClaim(args: string[], io: CliIo): Promise<number> {
  usage(() => parseArgs({ args, options: {}, strict: true }));
  const result = await withDb(io, (db) => db.claim());
  io.stdout(JSON.stringify(result));
  return EXIT.ok;
}

async function cmdSnapshot(args: string[], io: CliIo): Promise<number> {
  const { values } = usage(() =>
    parseArgs({ args, options: { out: { type: 'string' }, 'storage-url': { type: 'string' } }, strict: true }),
  );
  const outDir = required(values.out, '--out DIR', 'snapshot');
  const storageUrl = values['storage-url'] ?? DEFAULT_STORAGE_URL;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(storageUrl);
  } catch {
    throw new UsageError('snapshot: --storage-url musi być adresem http(s)://host[:port]');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.search || parsedUrl.hash) {
    throw new UsageError('snapshot: --storage-url musi być adresem http(s)://host[:port]');
  }

  const raw = await withDb(io, (db) => db.snapshot());
  const parsed = siteSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BuildError(`migawka z bazy niezgodna ze schematem: ${issue?.path.join('.')} ${issue?.message}`);
  }
  mkdirSync(outDir, { recursive: true });
  const prepared = await prepareSnapshot(parsed.data, {
    storageUrl,
    outDir,
    fetch: nodeStorageFetch(),
    warn: (message) => io.stderr(`snapshot: ${message}`),
  });
  const sha256 = writeSnapshotFile(outDir, prepared.snapshot);
  io.stdout(JSON.stringify({ ok: true, assets: prepared.assets, sha256 }));
  return EXIT.ok;
}

async function cmdBuild(args: string[], io: CliIo): Promise<number> {
  const { values } = usage(() =>
    parseArgs({
      args,
      options: {
        snapshot: { type: 'string' },
        'site-config': { type: 'string' },
        out: { type: 'string' },
        'deny-host': { type: 'string', multiple: true },
      },
      strict: true,
    }),
  );
  const snapshotDir = required(values.snapshot, '--snapshot DIR', 'build');
  const configFile = required(values['site-config'], '--site-config FILE', 'build');
  const outDir = required(values.out, '--out DIST', 'build');
  const denyHosts = values['deny-host'] ?? [];
  if (denyHosts.some((host) => !host.trim())) throw new UsageError('build: pusty --deny-host');

  const siteConfig = loadSiteConfig(configFile);
  const distDir = defaultSiteDist(io.env);
  const clientDir = join(distDir, 'client');
  if (!existsSync(join(distDir, 'server', 'render.js')) || !existsSync(clientDir)) {
    throw new ConfigError(`brak builda strony w ${distDir} (client/ i server/render.js; pnpm build:site)`);
  }
  // Daty wydarzeń w HTML w czasie polskim, niezależnie od strefy kontenera.
  io.env.TZ = 'Europe/Warsaw';
  process.env.TZ = 'Europe/Warsaw';

  const result = buildSite({
    snapshotDir,
    siteConfig,
    outDir,
    denyHosts,
    clientDir,
    render: await io.loadRender(distDir),
  });
  if (!result.ok) {
    for (const finding of result.findings.slice(0, 50)) io.stderr(`strażnik zero-adres: ${finding.file}: ${finding.issue}`);
    io.stdout(JSON.stringify({ ok: false, error: 'zero_address', findings: result.findings.slice(0, 200) }));
    return EXIT.guard;
  }
  io.stdout(JSON.stringify({ ok: true, files: result.files, bytes: result.bytes }));
  return EXIT.ok;
}

async function cmdFinish(args: string[], io: CliIo): Promise<number> {
  const { values } = usage(() =>
    parseArgs({
      args,
      options: {
        job: { type: 'string' },
        status: { type: 'string' },
        'deployment-id': { type: 'string' },
        error: { type: 'string' },
      },
      strict: true,
    }),
  );
  const job = required(values.job, '--job UUID', 'finish');
  if (!UUID_RE.test(job)) throw new UsageError('finish: --job musi być UUID');
  const status = required(values.status, '--status ok|failed', 'finish');
  if (status !== 'ok' && status !== 'failed') throw new UsageError('finish: --status ok|failed');
  const deploymentId = values['deployment-id'] ?? null;
  if (deploymentId !== null && !DEPLOYMENT_ID_RE.test(deploymentId)) {
    throw new UsageError('finish: --deployment-id: [A-Za-z0-9._-]{1,128}');
  }
  const error = values.error ?? null;
  if (error !== null && !ERROR_CODE_RE.test(error)) throw new UsageError('finish: --error: [a-z0-9_.:-]{1,64}');

  await withDb(io, (db) => db.finish(job, status, deploymentId, error));
  io.stdout(JSON.stringify({ ok: true, job, status }));
  return EXIT.ok;
}

const COMMANDS: Record<string, (args: string[], io: CliIo) => Promise<number>> = {
  claim: cmdClaim,
  snapshot: cmdSnapshot,
  build: cmdBuild,
  finish: cmdFinish,
};

export async function main(argv: string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv;
  try {
    const run = command ? COMMANDS[command] : undefined;
    if (!run) throw new UsageError(command ? `nieznana komenda: ${command}` : 'brak komendy');
    return await run(args, io);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [code, error] =
      err instanceof UsageError
        ? [EXIT.usage, 'usage']
        : err instanceof ConfigError
          ? [EXIT.config, 'config']
          : err instanceof StorageError
            ? [EXIT.error, 'storage']
            : [EXIT.error, 'error'];
    io.stderr(`site: ${message}`);
    if (err instanceof UsageError) io.stderr(USAGE);
    io.stdout(JSON.stringify({ ok: false, error, message }));
    return code;
  }
}

export const nodeIo: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  connectDb: connectPublisherDb,
  // render.js leży w LEGATTO_SITE_DIST (ścieżka z env w chwili uruchomienia), poza bundlem CLI - import dynamiczny.
  loadRender: async (distDir) =>
    (await import(pathToFileURL(join(distDir, 'server', 'render.js')).href)) as RenderModule,
  env: process.env,
};

// Uruchomienie jako program (node site.mjs ...), nie import w testach; realpath - /tmp na macOS to dowiązanie.
const entry = process.argv[1];
const invokedDirectly = entry !== undefined && existsSync(entry) && realpathSync(entry) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2), nodeIo);
}

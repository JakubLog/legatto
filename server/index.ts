// Serwer aplikacji na VPS biura (obraz `app`): ten sam kod api/** co na Vercelu.
//   :PORT (3000)          - publiczny przez Caddy: SPA z dist/, api/** i reguły z vercel.json;
//   :INTERNAL_PORT (3001) - tylko sieć legatto-int: /livez, /healthz, hook maili Auth.
// SIGTERM: przestaje przyjmować połączenia i czeka na trwające żądania (najdłuższa funkcja ma
// maxDuration 300 s), najwyżej SHUTDOWN_GRACE_SECONDS.

import http from 'node:http';
import path from 'node:path';
import { deploymentTarget } from '../api/_lib/instance.js';
import { readPiiFieldKey } from '../api/_lib/pii-key.js';
import { createAppHandler, parseTrustedProxies } from './app.js';
import { defaultHookDeps } from './auth-email-hook.js';
import { HANDLERS } from './handlers.js';
import { configChecks, createInternalHandler } from './internal.js';
import { APP_TITLE_PLACEHOLDER, appTitle, escapeHtml } from './runtime-config.js';
import { StaticFiles } from './static.js';
import { loadVercelConfig } from './vercel-config.js';
import { APP_VERSION } from './version.js';

const SHUTDOWN_GRACE_SECONDS = 310;

function port(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Niepoprawny port: ${raw}`);
  return value;
}

function main(): void {
  const env = process.env;
  const appRoot = env.LEGATTO_APP_ROOT?.trim() || process.cwd();
  const config = loadVercelConfig(path.join(appRoot, 'vercel.json'));
  const title = appTitle(env);
  // Build self-host zostawia %APP_TITLE% w index.html i manifeście PWA; tytuł biura jest w env.
  const staticFiles = new StaticFiles(path.join(appRoot, 'dist'), {
    '/index.html': (html) => html.replaceAll(APP_TITLE_PLACEHOLDER, escapeHtml(title)),
    '/manifest.webmanifest': (manifest) => manifest.replaceAll(APP_TITLE_PLACEHOLDER, JSON.stringify(title).slice(1, -1)),
  });

  let active = 0;
  const app = createAppHandler({
    config,
    loadHandler: (file) => HANDLERS[file],
    staticFiles,
    env,
    version: APP_VERSION,
    trustedProxies: parseTrustedProxies(env.TRUSTED_PROXY_IPS),
    onActivity: (delta) => {
      active += delta;
    },
  });

  let hook = null;
  let inviteTemplate: string | null = null;
  try {
    hook = defaultHookDeps(env, appRoot);
    inviteTemplate = hook.inviteTemplate;
    if (hook.secrets.length === 0) hook = null;
  } catch (err) {
    console.error(`[server] hook maili Auth wyłączony: ${err instanceof Error ? err.message : 'błąd konfiguracji'}`);
  }
  const internal = createInternalHandler({ env, version: APP_VERSION, hook, inviteTemplate });

  const serverOptions: http.ServerOptions = { headersTimeout: 15_000, requestTimeout: 60_000, keepAliveTimeout: 5_000 };
  const publicServer = http.createServer(serverOptions, (req, res) => void app(req, res));
  const internalServer = http.createServer(serverOptions, (req, res) => void internal(req, res));

  const host = env.HOST?.trim() || '0.0.0.0';
  const publicPort = port(env.PORT, 3000);
  const internalPort = port(env.INTERNAL_PORT, 3001);
  publicServer.listen(publicPort, host);
  internalServer.listen(internalPort, host);

  const missing = Object.entries(configChecks(env))
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  console.log(
    `[server] legatto-app ${APP_VERSION} (${deploymentTarget(env)}) :${publicPort} / :${internalPort}` +
      `${hook ? '' : ', bez hooka maili Auth'}, klucz PII: ${readPiiFieldKey(env).status}`,
  );
  if (missing.length > 0) console.error(`[server] brak konfiguracji: ${missing.join(', ')}`);

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[server] ${signal}: zamykanie (trwające żądania: ${active})`);
    publicServer.close();
    internalServer.close();
    publicServer.closeIdleConnections();
    internalServer.closeIdleConnections();
    const deadline = Date.now() + SHUTDOWN_GRACE_SECONDS * 1000;
    const poll = setInterval(() => {
      if (active <= 0 || Date.now() > deadline) {
        clearInterval(poll);
        process.exit(0);
      }
    }, 250);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();

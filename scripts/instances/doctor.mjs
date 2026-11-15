#!/usr/bin/env node
// Kontrola istniejącej instancji (jedna instancja = jeden poseł, ADR 026). TYLKO ODCZYT: wyłącznie żądania GET.
//
//   [SUPABASE_ACCESS_TOKEN=sbp_...] [SUPABASE_ANON_KEY=...] node scripts/instances/doctor.mjs <domena> <ref>
//
// Bez tokenu Management API pomija kontrole konfiguracji projektu (Auth, sekrety, funkcje, kopie, SSL, migracje).
// Klucz anon: SUPABASE_ANON_KEY, inaczej z bundla strony, inaczej z Management API. Kod wyjścia 1 przy każdym FAIL.
// Uruchamiaj po każdym wdrożeniu i po provisioningu (scripts/instances/provision.mjs).
import fs from 'node:fs';
import path from 'node:path';
import {
  ANON_READABLE_TABLES,
  ANON_RPC_PREFIX,
  INVITE_SUBJECT,
  MANAGEMENT_API,
  PASSWORD_REQUIRED_CHARACTERS,
  REPO_ROOT,
  REQUIRED_EDGE_SECRETS,
  edgeFunctionSlugs,
  managementToken,
  migrationVersions,
  parseDomain,
  parseRef,
} from './policy.mjs';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (positional.length !== 2) {
  console.log('Użycie: [SUPABASE_ACCESS_TOKEN=...] node scripts/instances/doctor.mjs <domena> <ref>');
  process.exit(2);
}
const domain = parseDomain(positional[0]);
const ref = parseRef(positional[1]);
const origin = `https://${domain}`;
const supabaseUrl = `https://${ref}.supabase.co`;
const token = managementToken();

const counts = { OK: 0, WARN: 0, FAIL: 0, SKIP: 0 };
function report(level, area, message) {
  counts[level] += 1;
  console.log(`[${level}]${' '.repeat(5 - level.length)}${area}: ${message}`);
}
const check = (ok, area, okMsg, failMsg, level = 'FAIL') => report(ok ? 'OK' : level, area, ok ? okMsg : failMsg);

async function get(url, headers = {}) {
  return fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20000) });
}
async function getJson(url, headers = {}) {
  const res = await get(url, headers);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // zostaje null
  }
  return { status: res.status, body, headers: res.headers };
}
async function management(pathname) {
  return getJson(`${MANAGEMENT_API}${pathname}`, { Authorization: `Bearer ${token}` });
}
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

const REF_RE = /\b([a-z]{20})\.supabase\.co\b/g;
const otherRefs = (text) => [...new Set([...text.matchAll(REF_RE)].map((m) => m[1]))].filter((r) => r !== ref);
function jwtPayload(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Strona: nagłówki, CSP (nagłówek + meta), bundel
// ---------------------------------------------------------------------------------------------
let anonKey = process.env.SUPABASE_ANON_KEY?.trim() || null;

const page = await get(`${origin}/`);
const html = await page.text();
check(page.status === 200, 'strona', `GET ${origin}/ → 200`, `GET ${origin}/ → ${page.status}`);

const hsts = page.headers.get('strict-transport-security') ?? '';
if (!/max-age=\d+/.test(hsts)) report('FAIL', 'nagłówki', 'brak Strict-Transport-Security');
else if (/preload|includesubdomains/i.test(hsts)) report('WARN', 'nagłówki', `HSTS "${hsts}" - preload/includeSubDomains obejmą domenę klienta`);
else report('OK', 'nagłówki', `HSTS ${hsts}`);
check(page.headers.get('x-frame-options')?.toUpperCase() === 'DENY', 'nagłówki', 'X-Frame-Options DENY', 'brak X-Frame-Options: DENY');
check(page.headers.get('x-content-type-options') === 'nosniff', 'nagłówki', 'X-Content-Type-Options nosniff', 'brak X-Content-Type-Options: nosniff', 'WARN');

const headerCsp = page.headers.get('content-security-policy') ?? '';
if (!headerCsp) report('FAIL', 'CSP', 'brak nagłówka Content-Security-Policy');
else {
  check(/frame-ancestors 'none'/.test(headerCsp), 'CSP', "nagłówek z frame-ancestors 'none'", "nagłówek bez frame-ancestors 'none'");
  const foreign = otherRefs(headerCsp);
  check(foreign.length === 0, 'CSP', 'nagłówek bez refów innych projektów', `nagłówek wpuszcza inny projekt Supabase: ${foreign.join(', ')}`);
}
const metaCsp = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i.exec(html)?.[1].replaceAll('&#39;', "'") ?? '';
if (!metaCsp) report('FAIL', 'CSP', 'brak <meta> CSP instancji w index.html (build sprzed vite.config.ts → instanceCsp?)');
else {
  const connect = /connect-src([^;]*)/.exec(metaCsp)?.[1] ?? '';
  check(
    connect.includes(supabaseUrl) && connect.includes(`wss://${ref}.supabase.co`),
    'CSP',
    `meta CSP: connect-src z ${ref}`,
    `meta CSP bez https/wss ${ref} w connect-src`,
  );
  const foreign = otherRefs(metaCsp);
  check(foreign.length === 0, 'CSP', 'meta CSP bez refów innych projektów', `meta CSP z innym projektem Supabase: ${foreign.join(', ')}`);
}

const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]))];
const bundleRefs = new Set();
let bundleAnon = null;
for (const asset of assets) {
  const js = await (await get(`${origin}${asset}`)).text();
  for (const m of js.matchAll(REF_RE)) bundleRefs.add(m[1]);
  for (const [jwt] of js.matchAll(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g)) {
    const payload = jwtPayload(jwt);
    if (payload?.role === 'service_role') report('FAIL', 'bundel', `${asset} zawiera klucz service_role!`);
    if (payload?.role === 'anon') {
      check(payload.ref === ref, 'bundel', `klucz anon projektu ${ref}`, `klucz anon w bundlu należy do projektu ${payload.ref}`);
      if (payload.ref === ref) bundleAnon ??= jwt;
    }
  }
  bundleAnon ??= /sb_publishable_[\w-]+/.exec(js)?.[0] ?? null;
}
if (assets.length === 0) report('FAIL', 'bundel', 'brak skryptów /assets/*.js w index.html');
else {
  const foreign = [...bundleRefs].filter((r) => r !== ref);
  check(bundleRefs.has(ref) && foreign.length === 0, 'bundel', `VITE_SUPABASE_URL = ${supabaseUrl}`, `refy Supabase w bundlu: ${[...bundleRefs].join(', ') || 'brak'}`);
}
anonKey ??= bundleAnon;

// ---------------------------------------------------------------------------------------------
// Vercel: OAuth discovery, cron bez sekretu, region funkcji
// ---------------------------------------------------------------------------------------------
const discovery = await getJson(`${origin}/.well-known/oauth-authorization-server`);
check(
  discovery.body?.issuer === origin,
  'OAuth',
  `issuer = ${origin}`,
  `issuer = ${discovery.body?.issuer ?? `(HTTP ${discovery.status})`} - ustaw OAUTH_ISSUER=${origin}`,
);
const cron = await get(`${origin}/api/cron/sync-ics`);
check(cron.status === 401, 'cron', '/api/cron/sync-ics bez sekretu → 401', `/api/cron/sync-ics bez sekretu → ${cron.status}`);
const fnRegion = cron.headers.get('x-vercel-id')?.split('::');
if (fnRegion && fnRegion.length >= 3) {
  check(fnRegion[1] === 'dub1', 'Vercel', 'funkcje api/ w dub1', `funkcje api/ w ${fnRegion[1]} (vercel.json: "regions": ["dub1"])`, 'WARN');
}

// ---------------------------------------------------------------------------------------------
// Supabase od strony anon
// ---------------------------------------------------------------------------------------------
if (!anonKey && token) {
  const keys = await management(`/v1/projects/${ref}/api-keys`);
  anonKey = (Array.isArray(keys.body) ? keys.body : []).find((k) => k.name === 'anon' || k.type === 'publishable')?.api_key ?? null;
}
if (!anonKey) {
  report('FAIL', 'anon', 'brak klucza anon (SUPABASE_ANON_KEY, bundel, Management API) - pominięto kontrole anon');
} else {
  const anonHeaders = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

  const settings = await getJson(`${supabaseUrl}/auth/v1/settings`, { apikey: anonKey });
  const s = settings.body ?? {};
  check(s.disable_signup === true, 'Auth', 'rejestracja publiczna wyłączona', 'rejestracja publiczna WŁĄCZONA (disable_signup != true)');
  const providers = Object.entries(s.external ?? {}).filter(([, on]) => on === true).map(([name]) => name);
  check(
    providers.length === 1 && providers[0] === 'email',
    'Auth',
    'logowanie tylko e-mailem',
    `włączeni dostawcy: ${providers.join(', ') || 'brak'} (oczekiwany tylko email; anonymous_users musi być false)`,
  );
  check(s.mailer_autoconfirm === false, 'Auth', 'potwierdzanie e-maili włączone', 'mailer_autoconfirm = true', 'WARN');

  const { tables, functions } = schemaFromMigrations();
  const tableResults = await inBatches(tables, 8, async (table) => {
    const res = await get(`${supabaseUrl}/rest/v1/${table}?select=*&limit=0`, anonHeaders);
    return { table, status: res.status };
  });
  for (const { table, status } of tableResults) {
    const expected = ANON_READABLE_TABLES.includes(table) ? 200 : 401;
    if (status === 404) report('WARN', 'anon REST', `${table}: 404 (tabela z migracji nie istnieje - migracje nieaplikowane?)`);
    else if (status !== expected) report('FAIL', 'anon REST', `${table}: ${status}, oczekiwano ${expected}`);
  }
  const tableFails = tableResults.filter((r) => r.status !== 404 && r.status !== (ANON_READABLE_TABLES.includes(r.table) ? 200 : 401));
  if (tableFails.length === 0) {
    report('OK', 'anon REST', `${tables.length} tabel/widoków: SELECT tylko ${ANON_READABLE_TABLES.join(', ')}`);
  }

  const rpcResults = await inBatches(functions, 8, async (fn) => {
    const query = new URLSearchParams(fn.params.map(({ name, type }) => [name, sampleValue(type)]));
    const res = await get(`${supabaseUrl}/rest/v1/rpc/${fn.name}?${query}`, anonHeaders);
    const body = await res.text();
    return { fn, status: res.status, code: /"code":"([^"]+)"/.exec(body)?.[1] };
  });
  let rpcFails = 0;
  for (const { fn, status, code } of rpcResults) {
    const isPublic = fn.name.startsWith(ANON_RPC_PREFIX);
    if (code === 'PGRST202') report('WARN', 'anon RPC', `${fn.name}: sygnatura z migracji nie pasuje do bazy (PGRST202) - nie sprawdzono`);
    else if (isPublic && status === 401) report('WARN', 'anon RPC', `${fn.name}: 401 - strona publiczna nie zadziała`);
    else if (!isPublic && status !== 401) {
      rpcFails += 1;
      report('FAIL', 'anon RPC', `${fn.name}: anon może wykonać (HTTP ${status}${code ? ` ${code}` : ''})`);
    }
  }
  if (rpcFails === 0) report('OK', 'anon RPC', `${functions.length} funkcji: anon wykonuje tylko ${ANON_RPC_PREFIX}*`);
}
report('SKIP', 'app_settings', 'wartości pierwszej instancji w app_settings - nieczytelne dla anon, sprawdź w panelu');

// ---------------------------------------------------------------------------------------------
// Management API (konfiguracja projektu)
// ---------------------------------------------------------------------------------------------
if (!token) {
  report('SKIP', 'Management API', 'brak SUPABASE_ACCESS_TOKEN - pominięto Auth/sekrety/funkcje/kopie/SSL/migracje');
} else {
  const project = await management(`/v1/projects/${ref}`);
  if (project.status !== 200) report('FAIL', 'projekt', `GET /v1/projects/${ref} → ${project.status}`);
  else check(String(project.body.region).startsWith('eu-'), 'projekt', `region ${project.body.region}`, `region ${project.body.region} poza UE`, 'WARN');

  const auth = (await management(`/v1/projects/${ref}/config/auth`)).body ?? {};
  const allowList = String(auth.uri_allow_list ?? '').split(',').map((u) => u.trim()).filter(Boolean);
  check(auth.site_url === origin, 'Auth config', `site_url = ${origin}`, `site_url = ${auth.site_url}`);
  const foreignRedirects = allowList.filter((u) => u !== origin && !u.startsWith(`${origin}/`));
  check(foreignRedirects.length === 0, 'Auth config', `redirecty: ${allowList.join(', ') || '(tylko site_url)'}`, `redirecty spoza ${origin}: ${foreignRedirects.join(', ')}`);
  check(auth.disable_signup === true && auth.external_anonymous_users_enabled === false, 'Auth config', 'bez rejestracji i kont anonimowych', 'rejestracja albo konta anonimowe włączone');
  check(auth.mfa_totp_enroll_enabled === true && auth.mfa_totp_verify_enabled === true, 'Auth config', 'TOTP enroll + verify', 'TOTP wyłączone');
  check(
    auth.password_min_length >= 12 && auth.password_required_characters === PASSWORD_REQUIRED_CHARACTERS,
    'Auth config',
    'hasło min. 12 znaków, 4 klasy',
    `polityka haseł: min ${auth.password_min_length}, klasy "${auth.password_required_characters ?? ''}"`,
  );
  check(auth.refresh_token_rotation_enabled === true, 'Auth config', 'rotacja refresh tokenów', 'rotacja refresh tokenów wyłączona');
  check(auth.security_update_password_require_reauthentication === true, 'Auth config', 'zmiana hasła: reautoryzacja', 'zmiana hasła bez reautoryzacji (secure password change)');
  check(auth.security_update_password_require_current_password === true, 'Auth config', 'zmiana hasła: wymagane obecne hasło', 'zmiana hasła bez obecnego hasła (Require current password when updating)');
  check(auth.mailer_subjects_invite === INVITE_SUBJECT, 'Auth config', 'temat zaproszenia neutralny', `temat zaproszenia: "${auth.mailer_subjects_invite}"`, 'WARN');
  const template = String(auth.mailer_templates_invite_content ?? '');
  const templateHosts = [...new Set([...template.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()))].filter((h) => h !== domain && h !== 'www.w3.org');
  check(templateHosts.length === 0, 'Auth config', 'szablon zaproszenia bez obcych domen', `szablon zaproszenia linkuje do: ${templateHosts.join(', ')}`, 'WARN');
  check(auth.password_hibp_enabled === true, 'Auth config', 'HIBP włączone', 'HIBP wyłączone (plan Pro)', 'WARN');
  check(auth.sessions_timebox > 0 && auth.sessions_inactivity_timeout > 0, 'Auth config', 'limity sesji ustawione', 'sesje bez limitu czasu/bezczynności (plan Pro)', 'WARN');
  check(Boolean(auth.smtp_host), 'Auth config', `SMTP ${auth.smtp_host}`, 'SMTP nieustawiony - zaproszenia dochodzą tylko do członków zespołu projektu', 'WARN');
  check(auth.security_captcha_enabled === true, 'Auth config', 'CAPTCHA na Auth', 'brak CAPTCHA na /auth/v1/* (wymaga captchaToken we froncie)', 'WARN');

  const secrets = await management(`/v1/projects/${ref}/secrets`);
  const names = new Set((Array.isArray(secrets.body) ? secrets.body : []).map((x) => x.name));
  for (const name of REQUIRED_EDGE_SECRETS) check(names.has(name), 'sekrety Edge', `${name} ustawiony`, `brak ${name}`);

  const fns = await management(`/v1/projects/${ref}/functions`);
  const deployed = new Map((Array.isArray(fns.body) ? fns.body : []).map((f) => [f.slug, f]));
  for (const slug of edgeFunctionSlugs()) {
    const fn = deployed.get(slug);
    if (!fn) report('FAIL', 'Edge Functions', `${slug} niewdrożona`);
    else check(fn.verify_jwt === true, 'Edge Functions', `${slug} verify_jwt`, `${slug} bez verify_jwt`);
    deployed.delete(slug);
  }
  for (const slug of deployed.keys()) report('WARN', 'Edge Functions', `${slug} wdrożona, ale nie ma jej w repo`);

  const backups = (await management(`/v1/projects/${ref}/database/backups`)).body ?? {};
  check(
    backups.pitr_enabled === true || (backups.backups?.length ?? 0) > 0,
    'kopie',
    backups.pitr_enabled ? 'PITR włączone' : `${backups.backups?.length} kopii`,
    'brak kopii zapasowych i PITR (plan Pro albo scripts/instances/backup.sh)',
    'WARN',
  );
  const ssl = (await management(`/v1/projects/${ref}/ssl-enforcement`)).body ?? {};
  check(ssl.currentConfig?.database === true, 'baza', 'SSL wymuszony', 'SSL do Postgresa niewymuszony (provision.mjs to ustawia)');
  const network = (await management(`/v1/projects/${ref}/network-restrictions`)).body ?? {};
  const cidrs = network.config?.dbAllowedCidrs ?? [];
  check(!cidrs.includes('0.0.0.0/0'), 'baza', `dostęp do Postgresa z ${cidrs.join(', ')}`, 'Postgres dostępny z całego internetu (Network restrictions)', 'WARN');

  const migrations = await management(`/v1/projects/${ref}/database/migrations`);
  if (migrations.status !== 200 || !Array.isArray(migrations.body)) {
    report('SKIP', 'migracje', `historia migracji niedostępna (HTTP ${migrations.status})`);
  } else {
    const remote = new Set(migrations.body.map((m) => m.version));
    const local = migrationVersions();
    const missing = local.filter((v) => !remote.has(v));
    const extra = [...remote].filter((v) => !local.includes(v));
    check(missing.length === 0, 'migracje', `${remote.size} migracji = repo`, `brak na instancji: ${missing.join(', ')}`);
    if (extra.length) report('WARN', 'migracje', `na instancji, nie w repo: ${extra.join(', ')}`);
  }
}

console.log(`\nPodsumowanie: ${counts.OK} OK, ${counts.WARN} WARN, ${counts.FAIL} FAIL, ${counts.SKIP} SKIP`);
process.exitCode = counts.FAIL > 0 ? 1 : 0;

// ---------------------------------------------------------------------------------------------
// Schemat z migracji: tabele/widoki i funkcje schematu public (ostatnia definicja wygrywa)
// ---------------------------------------------------------------------------------------------
function schemaFromMigrations() {
  const dir = path.join(REPO_ROOT, 'supabase/migrations');
  const tables = new Set();
  const functions = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/--[^\n]*/g, '');
    const events = [];
    const patterns = [
      ['table+', /create\s+(?:or\s+replace\s+)?(?:table|view|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi],
      ['table-', /drop\s+(?:table|view|materialized\s+view)\s+(?:if\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi],
      ['fn+', /create\s+(?:or\s+replace\s+)?function\s+(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/gi],
      ['fn-', /drop\s+function\s+(?:if\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi],
    ];
    for (const [kind, re] of patterns) {
      for (const m of sql.matchAll(re)) {
        if (m[1] && m[1].toLowerCase() !== 'public') continue;
        events.push({ kind, index: m.index, end: m.index + m[0].length, name: m[2].toLowerCase() });
      }
    }
    for (const e of events.sort((a, b) => a.index - b.index)) {
      if (e.kind === 'table+') tables.add(e.name);
      else if (e.kind === 'table-') tables.delete(e.name);
      else if (e.kind === 'fn-') functions.delete(e.name);
      else {
        const fn = parseFunction(sql, e.end, e.name);
        if (fn) functions.set(e.name, fn);
        else functions.delete(e.name);
      }
    }
  }
  return { tables: [...tables].sort(), functions: [...functions.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

/** `start` = indeks za "(" listy argumentów. Zwraca null dla funkcji wyzwalaczy (nie są RPC). */
function parseFunction(sql, start, name) {
  let depth = 1;
  let i = start;
  while (i < sql.length && depth > 0) {
    if (sql[i] === '(') depth += 1;
    else if (sql[i] === ')') depth -= 1;
    i += 1;
  }
  const argList = sql.slice(start, i - 1);
  if (/^\s*returns\s+(?:event_)?trigger\b/i.test(sql.slice(i, i + 200))) return null;
  const args = [];
  let current = '';
  depth = 0;
  for (const ch of argList) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      args.push(current);
      current = '';
    } else current += ch;
  }
  if (current.trim()) args.push(current);
  const params = [];
  for (const raw of args) {
    const arg = raw.trim().replace(/^(?:in|inout|variadic)\s+/i, '');
    if (/^out\s/i.test(raw.trim()) || /\s(?:default|=)\s/i.test(` ${arg} `)) continue;
    const [argName, ...type] = arg.split(/\s+/);
    params.push({ name: argName.replaceAll('"', ''), type: type.join(' ').toLowerCase() });
  }
  return { name, params };
}

function sampleValue(type) {
  if (type.endsWith('[]')) return '{}';
  if (type.startsWith('uuid')) return '00000000-0000-0000-0000-000000000000';
  if (/^(?:int|integer|bigint|smallint|numeric|real|double)/.test(type)) return '0';
  if (type.startsWith('bool')) return 'false';
  if (type.startsWith('date')) return '2000-01-01';
  if (type.startsWith('timestamp')) return '2000-01-01T00:00:00Z';
  if (type.startsWith('json')) return '{}';
  return 'x';
}

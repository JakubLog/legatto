#!/usr/bin/env node
// Provisioning NOWEJ instancji (jedna instancja = jeden poseł, ADR 026) przez Supabase Management API.
// Idempotentny: każde uruchomienie ustawia te same wartości; istniejącej soli PUBLIC_SUBMISSION_IP_SALT nie zmienia.
//
//   SUPABASE_ACCESS_TOKEN=sbp_... [TURNSTILE_SECRET=...] node scripts/instances/provision.mjs <ref> <domena> [--dry-run]
//
// --dry-run: wypisuje planowane żądania (bez sekretów) i niczego nie wysyła (token niewymagany).
// Sekretów nie wypisuje nigdy. Kroki poza Management API (migracje, funkcje, Vercel, SMTP) wypisuje na końcu.
import crypto from 'node:crypto';
import {
  MANAGEMENT_API,
  PRO_AUTH_CONFIG,
  REQUIRED_EDGE_SECRETS,
  authConfig,
  managementToken,
  parseDomain,
  parseRef,
} from './policy.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((a) => !a.startsWith('--'));
if (args.includes('--help') || positional.length !== 2) {
  console.log('Użycie: SUPABASE_ACCESS_TOKEN=... [TURNSTILE_SECRET=...] node scripts/instances/provision.mjs <ref> <domena> [--dry-run]');
  process.exit(positional.length === 2 ? 0 : 2);
}

const ref = parseRef(positional[0]);
const domain = parseDomain(positional[1]);
const origin = `https://${domain}`;
const token = managementToken();
if (!dryRun && !token) {
  console.error('Brak SUPABASE_ACCESS_TOKEN (token osobisty Supabase z dostępem do projektu).');
  process.exit(2);
}
const turnstileSecret = process.env.TURNSTILE_SECRET?.trim() || null;

const SECRET_FIELDS = new Set(['security_captcha_secret', 'smtp_pass']);
const warnings = [];

const PUBLIC_SECRET_NAMES = new Set(['ALLOWED_ORIGINS', 'AUTH_REDIRECT_URL']);
function redact(body) {
  if (Array.isArray(body)) return body.map((s) => ({ name: s.name, value: PUBLIC_SECRET_NAMES.has(s.name) ? s.value : '<sekret>' }));
  if (!body || typeof body !== 'object') return body;
  return Object.fromEntries(
    Object.entries(body).map(([k, v]) => {
      if (SECRET_FIELDS.has(k)) return [k, '<sekret>'];
      if (k === 'mailer_templates_invite_content') return [k, `<supabase/templates/invite.html, ${v.length} znaków>`];
      return [k, v];
    }),
  );
}

async function api(method, path, body, { tolerate = [] } = {}) {
  if (dryRun) {
    console.log(`\n${method} ${MANAGEMENT_API}${path}`);
    if (body !== undefined) console.log(JSON.stringify(redact(body), null, 2));
    return null;
  }
  const res = await fetch(`${MANAGEMENT_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (tolerate.includes(res.status)) {
    return { tolerated: res.status, message: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function step(title) {
  console.log(`\n== ${title}`);
}

step(`Projekt ${ref} → ${origin}${dryRun ? ' (dry-run: nic nie jest wysyłane)' : ''}`);
const project = await api('GET', `/v1/projects/${ref}`);
if (project) {
  console.log(`Projekt: ${project.name} (${project.region}, ${project.status})`);
  if (!String(project.region).startsWith('eu-')) warnings.push(`Region bazy ${project.region} poza UE.`);
}

step('Auth: rejestracja, adresy, hasła, 2FA, sesje, szablon zaproszenia');
// CAPTCHA na /auth/v1/* (security_captcha_*) celowo nieustawiana: frontend nie wysyła captchaToken przy logowaniu
// i resecie hasła, więc włączenie zablokowałoby logowanie.
await api('PATCH', `/v1/projects/${ref}/config/auth`, authConfig(origin));

step('Auth (plan Pro): HIBP, limit czasu i bezczynności sesji');
const pro = await api('PATCH', `/v1/projects/${ref}/config/auth`, PRO_AUTH_CONFIG, { tolerate: [402] });
if (pro?.tolerated) warnings.push('HIBP i limity sesji wymagają planu Pro (Management API 402) - pominięte.');

step('Baza: wymuszenie SSL');
await api('PUT', `/v1/projects/${ref}/ssl-enforcement`, { requestedConfig: { database: true } });

step('Sekrety Edge Functions');
const existing = dryRun ? null : new Set(((await api('GET', `/v1/projects/${ref}/secrets`)) ?? []).map((s) => s.name));
const secrets = [
  { name: 'ALLOWED_ORIGINS', value: origin },
  { name: 'AUTH_REDIRECT_URL', value: `${origin}/login` },
];
if (turnstileSecret) secrets.push({ name: 'TURNSTILE_SECRET', value: turnstileSecret });
else if (dryRun || !existing.has('TURNSTILE_SECRET')) {
  warnings.push('Brak TURNSTILE_SECRET: formularz zgłoszeń zwraca 500. Uruchom ponownie z TURNSTILE_SECRET=<secret witryny Turnstile>.');
}
// Zmiana soli zrywa ciągłość hashy IP (limity zgłoszeń) - generujemy tylko, gdy jej nie ma.
if (dryRun) console.log('PUBLIC_SUBMISSION_IP_SALT: losowa (32 B hex), tylko gdy sekretu jeszcze nie ma');
else if (!existing.has('PUBLIC_SUBMISSION_IP_SALT')) {
  secrets.push({ name: 'PUBLIC_SUBMISSION_IP_SALT', value: crypto.randomBytes(32).toString('hex') });
}
await api('POST', `/v1/projects/${ref}/secrets`, secrets);
if (!dryRun) {
  const after = new Set(((await api('GET', `/v1/projects/${ref}/secrets`)) ?? []).map((s) => s.name));
  console.log(`Sekrety: ${REQUIRED_EDGE_SECRETS.map((n) => `${n} ${after.has(n) ? 'OK' : 'BRAK'}`).join(', ')}`);
}

if (!dryRun) {
  step('Kontrola: publiczne ustawienia Auth');
  const keys = await api('GET', `/v1/projects/${ref}/api-keys`);
  const anon = keys?.find((k) => k.name === 'anon' || k.type === 'publishable')?.api_key;
  const res = await fetch(`https://${ref}.supabase.co/auth/v1/settings`, { headers: { apikey: anon } });
  const settings = await res.json();
  if (settings.disable_signup !== true) throw new Error('GET /auth/v1/settings: disable_signup nadal nie jest true.');
  console.log('disable_signup = true');
}

console.log(`
== Pozostałe kroki (ręczne)
1. supabase link --project-ref ${ref} && supabase db push --linked   (migracje; okręg ≠ 35: seed słowników z README)
2. supabase functions deploy --project-ref ${ref}                     (Edge Functions; db push ich nie wdraża)
3. Supabase → Authentication → SMTP: własny serwer (domyślny wysyła tylko do członków zespołu projektu).
4. Supabase → Database → Network restrictions: zawęź dostęp do Postgresa (aplikacja używa tylko HTTPS API).
5. Vercel: projekt z repo, zmienne z .env.example (VITE_SUPABASE_URL=https://${ref}.supabase.co, klucze, CRON_SECRET,
   opcjonalnie OAUTH_ISSUER=${origin}), domena ${domain}; alias *.vercel.app przekieruj na domenę albo usuń.
6. Plan Pro: kopie zapasowe / PITR, HIBP, limity sesji (potem uruchom ten skrypt ponownie).
7. Kontrola: node scripts/instances/doctor.mjs ${domain} ${ref}`);
if (warnings.length) console.log(`\n== Ostrzeżenia\n${warnings.map((w) => `- ${w}`).join('\n')}`);

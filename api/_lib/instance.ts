// Konfiguracja instancji ustawiana przez operatora (env Vercela albo env kontenera app na VPS),
// nie w panelu aplikacji.
//
// LEGATTO_TARGET=selfhost  - instancja na serwerze biura (obraz app, server/); inaczej Vercel.
//
// Flagi (on|off):
// INSTANCE_AI          - PoliAI, raporty AI budzetu, OCR zalacznikow (api.anthropic.com).
// INSTANCE_MCP         - serwer MCP i OAuth dla klientow MCP (/api/mcp, /api/oauth/*,
//                        /.well-known/oauth-authorization-server). Niezalezne od INSTANCE_AI:
//                        na VPS MCP dziala tylko w tailnecie, bez AI na serwerze.
// INSTANCE_EMAIL       - wysylka e-maili powiadomien (Resend). Maile Auth (zaproszenia, reset hasla)
//                        nie zaleza od tej flagi.
// INSTANCE_PUSH        - web push (uslugi push przegladarek).
// INSTANCE_GETRESPONSE - integracja GetResponse (newsletter, sygnal w briefingu).
// INSTANCE_ICS         - synchronizacja kalendarzy ICS; na VPS tylko hosty z ICS_ALLOWED_HOSTS.
//
// Brak wartosci = domyslna dla celu wdrozenia (tabela DEFAULTS): AI, MCP i e-mail sa zawsze
// wylaczone (fail-closed, blad w logu - dodatki wlacza operator), push/GetResponse/ICS na Vercelu
// dzialaja jak dotad, na VPS sa opt-in (egress tylko po wlaczeniu funkcji przez admina biura).
// Niepoprawna wartosc = off i blad w logu.
//
// Ten sam modul czyta api/ (runtime), server/ (runtime-config.js) i vite.config.ts (build Vercela
// i serwer deweloperski), wiec frontend i serwer biora flagi z tych samych zmiennych.
// Bez zaleznosci i bez importow z api/ - importuje go tez vite.config.ts.
//
// Klucz i modele AI operatora (opcjonalne, pierwszenstwo przed Integracje -> AI):
// AI_API_KEY, AI_MODEL, AI_FAST_MODEL.

import type { InstanceFlags } from '../../src/lib/runtime-config-types.js';

export type { InstanceFlags };

type Env = Record<string, string | undefined>;

export type DeploymentTarget = 'vercel' | 'selfhost';

export function deploymentTarget(env: Env = process.env): DeploymentTarget {
  return env.LEGATTO_TARGET?.trim() === 'selfhost' ? 'selfhost' : 'vercel';
}

type FlagName = keyof InstanceFlags;

const VARIABLES: Record<FlagName, string> = {
  ai: 'INSTANCE_AI',
  mcp: 'INSTANCE_MCP',
  email: 'INSTANCE_EMAIL',
  push: 'INSTANCE_PUSH',
  getresponse: 'INSTANCE_GETRESPONSE',
  ics: 'INSTANCE_ICS',
};

/** Wartosc przy braku zmiennej; `null` = brak to blad konfiguracji (off + log). */
const DEFAULTS: Record<DeploymentTarget, Record<FlagName, boolean | null>> = {
  vercel: { ai: null, mcp: null, email: null, push: true, getresponse: true, ics: true },
  selfhost: { ai: null, mcp: null, email: null, push: false, getresponse: false, ics: false },
};

const warned = new Set<string>();

function warnOnce(name: string, message: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.error(`[instance] ${message}`);
}

function toggle(env: Env, flag: FlagName, target: DeploymentTarget): boolean {
  const name = VARIABLES[flag];
  const raw = env[name]?.trim().toLowerCase();
  if (raw === 'on') return true;
  if (raw === 'off') return false;
  const fallback = DEFAULTS[target][flag];
  if (!raw && fallback !== null) return fallback;
  const shown = env[name] === undefined ? '(brak)' : JSON.stringify(env[name]);
  warnOnce(name, `${name}=${shown}: oczekiwano "on" albo "off" - przyjmuję "off".`);
  return false;
}

export function instanceFlags(env: Env = process.env): InstanceFlags {
  const target = deploymentTarget(env);
  return {
    ai: toggle(env, 'ai', target),
    mcp: toggle(env, 'mcp', target),
    email: toggle(env, 'email', target),
    push: toggle(env, 'push', target),
    getresponse: toggle(env, 'getresponse', target),
    ics: toggle(env, 'ics', target),
  };
}

const HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Hosty kalendarzy ICS dozwolone na tej instancji (ICS_ALLOWED_HOSTS, lista po przecinku, dokladne
 * nazwy hostow). `null` = bez ograniczenia (tylko Vercel bez zmiennej). Na VPS brak zmiennej = pusta
 * lista: egress biura przepuszcza wylacznie hosty zatwierdzone przez admina, wiec aplikacja odrzuca
 * inne juz przy zapisie zrodla.
 */
export function icsAllowedHosts(env: Env = process.env): string[] | null {
  const raw = env.ICS_ALLOWED_HOSTS;
  if (raw === undefined && deploymentTarget(env) === 'vercel') return null;
  const hosts: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const host = part.trim().toLowerCase();
    if (!host) continue;
    if (!HOSTNAME_RE.test(host)) {
      warnOnce(`ICS_ALLOWED_HOSTS:${host}`, `ICS_ALLOWED_HOSTS: pomijam niepoprawna nazwe hosta ${JSON.stringify(host)}.`);
      continue;
    }
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/** Czy adres zrodla ICS jest dozwolony przez liste hostow instancji (bez sprawdzania SSRF). */
export function isIcsHostAllowed(rawUrl: string, env: Env = process.env): boolean {
  const allowed = icsAllowedHosts(env);
  if (allowed === null) return true;
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowed.includes(host);
}

export interface OperatorAi {
  apiKey: string | null;
  model: string | null;
  fastModel: string | null;
}

function optional(env: Env, name: string): string | null {
  return env[name]?.trim() || null;
}

/** Klucz i modele AI ustawione przez operatora w env (null = brak, uzyj ustawien z panelu / domyslnych). */
export function operatorAi(env: Env = process.env): OperatorAi {
  return {
    apiKey: optional(env, 'AI_API_KEY'),
    model: optional(env, 'AI_MODEL'),
    fastModel: optional(env, 'AI_FAST_MODEL'),
  };
}

export const AI_DISABLED = {
  status: 404,
  code: 'AI_DISABLED',
  error: 'Funkcje AI są wyłączone na tej instancji.',
} as const;

export const MCP_DISABLED = {
  status: 404,
  code: 'MCP_DISABLED',
  error: 'Serwer MCP jest wyłączony na tej instancji.',
} as const;

interface JsonResponse {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Bramka AI dla handlerow api/: przy INSTANCE_AI != on odpowiada 404 AI_DISABLED i zwraca true.
 * Wolac na samym poczatku handlera, przed uwierzytelnieniem i odczytem sekretow.
 */
export function rejectIfAiDisabled(res: JsonResponse): boolean {
  if (instanceFlags().ai) return false;
  res.status(AI_DISABLED.status).json({ error: AI_DISABLED.error, code: AI_DISABLED.code });
  return true;
}

/** Bramka MCP/OAuth (INSTANCE_MCP != on -> 404 MCP_DISABLED); jak rejectIfAiDisabled. */
export function rejectIfMcpDisabled(res: JsonResponse): boolean {
  if (instanceFlags().mcp) return false;
  res.status(MCP_DISABLED.status).json({ error: MCP_DISABLED.error, code: MCP_DISABLED.code });
  return true;
}

// Konfiguracja instancji ustawiana przez operatora (env Vercela), nie w panelu aplikacji.
//
// INSTANCE_AI=on|off     - PoliAI, raporty AI budzetu, OCR zalacznikow, MCP i OAuth dla Claude.
// INSTANCE_EMAIL=on|off  - wysylka e-maili powiadomien (Resend).
// Brak lub inna wartosc = off (i blad w logu): dodatki wlacza operator, nie domyslna konfiguracja.
//
// Ten sam modul czyta api/ (runtime) i vite.config.ts (build-time -> define __INSTANCE__ dla UI),
// wiec frontend i serwer biora flage z tej samej zmiennej tego samego wdrozenia.
// Bez zaleznosci i bez importow z api/ - importuje go tez vite.config.ts.
//
// Klucz i modele AI operatora (opcjonalne, pierwszenstwo przed Integracje -> AI):
// AI_API_KEY, AI_MODEL, AI_FAST_MODEL.

export interface InstanceFlags {
  ai: boolean;
  email: boolean;
}

type Env = Record<string, string | undefined>;

const warned = new Set<string>();

function toggle(env: Env, name: string): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === 'on') return true;
  if (raw === 'off') return false;
  if (!warned.has(name)) {
    warned.add(name);
    const shown = env[name] === undefined ? '(brak)' : JSON.stringify(env[name]);
    console.error(`[instance] ${name}=${shown}: oczekiwano "on" albo "off" - przyjmuję "off".`);
  }
  return false;
}

export function instanceFlags(env: Env = process.env): InstanceFlags {
  return { ai: toggle(env, 'INSTANCE_AI'), email: toggle(env, 'INSTANCE_EMAIL') };
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

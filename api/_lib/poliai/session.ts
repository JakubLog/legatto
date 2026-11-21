// Wspolne dla zadan PoliAI (czat i przygotowanie zalacznikow): sesja Supabase (Bearer
// access_token, aal2, rola MCP), ustawienia AI (env operatora albo Integracje -> AI) oraz
// dzienne limity liczone z audytu (atomowo w RPC poliai_claim_daily_slot).

import type { VercelRequest } from '@vercel/node';
import { getAnonClient, getServiceClient } from '../supabase.js';
import { isAal2Session } from '../jwt.js';
import { buildAuthContext, isMcpRole, loadAuthProfile, parseBearer, type McpAuthContext } from '../auth.js';
import { auditMetadata } from '../audit.js';
import { AI_DISABLED, instanceFlags, operatorAi } from '../instance.js';
import { DEFAULT_FAST_MODEL, DEFAULT_MODEL } from './anthropic.js';
import { getSiteIdentity, mpForms } from '../siteIdentity.js';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function authenticate(req: VercelRequest): Promise<McpAuthContext> {
  const token = parseBearer(req.headers.authorization);
  if (!token) throw new HttpError(401, 'Brak sesji');

  const { data, error } = await getAnonClient().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Nieprawidłowa lub wygasła sesja');
  if (!isAal2Session(token, data.user)) {
    throw new HttpError(403, 'Wymagana weryfikacja dwuetapowa (2FA)');
  }

  const profile = await loadAuthProfile(data.user.id);
  if (!profile?.is_active || !isMcpRole(profile.role)) {
    const mp = mpForms((await getSiteIdentity()).mp_gender);
    throw new HttpError(403, `PoliAI jest dostępne dla ${mp.genitive}, Administratora i Pracownika`);
  }
  return buildAuthContext(data.user.id, profile.role, profile, {
    channel: 'poliai',
    tokenId: null,
    userFullName: profile.full_name ?? '',
    scopes: [],
  });
}

export interface AiSettings {
  apiKey: string;
  /** Glowny model: czat, raport budzetu. */
  model: string;
  /** Szybki model: wstep, przyciski, pamiec, kompresja kontekstu, OCR. */
  fastModel: string;
}

async function loadVaultKey(): Promise<string> {
  const { data, error } = await getServiceClient().rpc('service_get_secrets', { p_keys: ['anthropic_api_key'] });
  if (error) throw new Error(`service_get_secrets: ${error.message}`);
  const secrets = (data ?? []) as { key: string; value: string }[];
  return secrets.find((row) => row.key === 'anthropic_api_key')?.value.trim() ?? '';
}

async function loadPanelModel(): Promise<string> {
  const { data, error } = await getServiceClient().from('app_settings').select('value').eq('key', 'ai_model').maybeSingle();
  if (error) throw new Error(`app_settings: ${error.message}`);
  return typeof data?.value === 'string' ? data.value.trim() : '';
}

/**
 * Klucz i modele AI. Pierwszenstwo ma env operatora (AI_API_KEY, AI_MODEL, AI_FAST_MODEL) -
 * wtedy Vault / app_settings nie sa czytane; inaczej klucz z Vault (service_get_secrets) i model
 * z Integracje -> AI. Przy kluczu operatora model wybiera tylko operator (AI_MODEL albo domyslny) -
 * koszt idzie na jego konto, wiec panel go nie zmienia. INSTANCE_AI != on = 404 AI_DISABLED (druga
 * linia obrony za bramka handlera), brak klucza = 409 AI_NOT_CONFIGURED.
 */
export async function requireAiSettings(): Promise<AiSettings> {
  if (!instanceFlags().ai) throw new HttpError(AI_DISABLED.status, AI_DISABLED.error, AI_DISABLED.code);
  const operator = operatorAi();
  const [apiKey, model] = await Promise.all([
    operator.apiKey ?? loadVaultKey(),
    operator.model ?? (operator.apiKey ? DEFAULT_MODEL : loadPanelModel()),
  ]);
  if (!apiKey) {
    const mp = mpForms((await getSiteIdentity()).mp_gender);
    throw new HttpError(
      409,
      `AI nie jest skonfigurowane. ${mp.nominative} lub Administrator musi dodać klucz w Integracje → AI (Claude).`,
      'AI_NOT_CONFIGURED',
    );
  }
  return { apiKey, model: model || DEFAULT_MODEL, fastModel: operator.fastModel ?? DEFAULT_FAST_MODEL };
}

export interface DailyLimit {
  /** Akcja audytu liczona do limitu (i zapisywana przy kazdym zadaniu). */
  action: string;
  limit: number;
  code: string;
  /** Komunikat 429 dla uzytkownika. */
  message: string;
}

/**
 * Limit zadan na 24 h liczony z audit_log. RPC poliai_claim_daily_slot (migracja
 * 20261107950000) pod blokada per uzytkownik i akcja liczy wpisy i zapisuje nowy w jednej
 * transakcji, przed wlasciwa praca - rownolegle zadania nie przekrocza limitu. Blad RPC =
 * odmowa (fail-closed).
 */
export async function enforceDailyLimit(
  ctx: McpAuthContext,
  limit: DailyLimit,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await getServiceClient().rpc('poliai_claim_daily_slot', {
    p_user_id: ctx.userId,
    p_action: limit.action,
    p_limit: limit.limit,
    p_metadata: auditMetadata(ctx, metadata),
  });
  if (error) {
    console.error('[poliai] daily limit claim error', error);
    throw new HttpError(500, 'Nie udało się sprawdzić dziennego limitu. Spróbuj ponownie.');
  }
  if (data !== true) throw new HttpError(429, limit.message, limit.code);
}

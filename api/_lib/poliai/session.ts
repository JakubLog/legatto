// Wspolne dla zadan PoliAI (czat i przygotowanie zalacznikow): sesja Supabase (Bearer
// access_token, aal2, rola MCP), ustawienia AI z Integracje -> AI oraz dzienne limity liczone
// z audytu (atomowo w RPC poliai_claim_daily_slot).

import type { VercelRequest } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { getServiceClient } from '../supabase.js';
import { isAal2Session } from '../jwt.js';
import { buildAuthContext, isMcpRole, loadAuthProfile, parseBearer, type McpAuthContext } from '../auth.js';
import { auditMetadata } from '../audit.js';
import { DEFAULT_MODEL } from './anthropic.js';
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

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
  const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await userClient.auth.getUser(token);
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
  model: string;
}

/** Klucz (Vault, service_get_secrets) i model z Integracje -> AI. Brak klucza = 409 AI_NOT_CONFIGURED. */
export async function requireAiSettings(): Promise<AiSettings> {
  const supabase = getServiceClient();
  const [secretsRes, modelRes] = await Promise.all([
    supabase.rpc('service_get_secrets', { p_keys: ['anthropic_api_key'] }),
    supabase.from('app_settings').select('value').eq('key', 'ai_model').maybeSingle(),
  ]);
  if (secretsRes.error) throw new Error(`service_get_secrets: ${secretsRes.error.message}`);
  if (modelRes.error) throw new Error(`app_settings: ${modelRes.error.message}`);
  const secrets = (secretsRes.data ?? []) as { key: string; value: string }[];
  const apiKey = secrets.find((row) => row.key === 'anthropic_api_key')?.value.trim() ?? '';
  const model = typeof modelRes.data?.value === 'string' ? modelRes.data.value.trim() : '';
  if (!apiKey) {
    const mp = mpForms((await getSiteIdentity()).mp_gender);
    throw new HttpError(
      409,
      `AI nie jest skonfigurowane. ${mp.nominative} lub Administrator musi dodać klucz w Integracje → AI (Claude).`,
      'AI_NOT_CONFIGURED',
    );
  }
  return { apiKey, model: model || DEFAULT_MODEL };
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

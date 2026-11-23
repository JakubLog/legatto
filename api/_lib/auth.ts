import { createHash } from 'node:crypto';
import { getServiceClient } from './supabase.js';
import { errorSummary } from './log-safe.js';

// Role z uprawnieniami Posla - Administrator to Posel pod inna nazwa (odpowiednik is_posel() z RLS).
export const POSEL_ROLES = ['posel', 'administrator'] as const;

export function isPoselRole(role: unknown): boolean {
  return (POSEL_ROLES as readonly unknown[]).includes(role);
}

// Role z dostepem do MCP i OAuth (asystent nie dostaje tokena - patrz create_mcp_token,
// create_oauth_client).
export const MCP_ROLES = [...POSEL_ROLES, 'pracownik'] as const;
export type McpRole = (typeof MCP_ROLES)[number];

export function isMcpRole(role: unknown): role is McpRole {
  return (MCP_ROLES as readonly unknown[]).includes(role);
}
export type DataScope = 'own' | 'all';
// Moduly z per-userowym zakresem danych (profiles.scope_*), egzekwowanym w RLS.
export type ScopedModule = 'cases' | 'contacts' | 'events' | 'interpellations';

// Kanal wywolania narzedzi: zewnetrzny klient MCP (token epm_), PoliAI w aplikacji (sesja Supabase)
// albo operacja portalu bez AI (sesja Supabase, np. reczne dodanie interpelacji w api/integracje.ts).
// Trafia do audytu (metadata.token_id / metadata.via).
export type ToolChannel = 'mcp' | 'poliai' | 'portal';

export interface McpAuthContext {
  channel: ToolChannel;
  // Tylko kanal 'mcp'.
  tokenId: string | null;
  userId: string;
  userFullName: string;
  userEmail: string;
  userRole: McpRole;
  officeId: string | null;
  // Odpowiednik current_*_scope() z RLS. Posel/Administrator zawsze 'all' (is_posel() bypass).
  dataScopes: Record<ScopedModule, DataScope>;
  scopes: string[];
}

export interface AuthProfile {
  full_name: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
  office_id: string | null;
  scope_cases: DataScope | null;
  scope_contacts: DataScope | null;
  scope_events: DataScope | null;
  scope_interpellations: DataScope | null;
}

// Service_role omija RLS, wiec zakresy danych (scope_*) czytamy sami i egzekwujemy
// w narzedziach (api/_lib/access.ts) - tak jak *_select_authenticated w bazie.
export async function loadAuthProfile(userId: string): Promise<AuthProfile | null> {
  const { data, error } = await getServiceClient()
    .from('profiles')
    .select(
      'full_name, email, role, is_active, office_id, scope_cases, scope_contacts, scope_events, scope_interpellations',
    )
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('[auth] profile read error', errorSummary(error));
    throw new Error('Odczyt profilu uzytkownika nie powiodl sie');
  }
  return data as AuthProfile | null;
}

export function buildAuthContext(
  userId: string,
  role: McpRole,
  profile: AuthProfile,
  source: { channel: ToolChannel; tokenId: string | null; userFullName: string; scopes: string[] },
): McpAuthContext {
  const isPosel = isPoselRole(role);
  // Brak wartosci (kolumny sa NOT NULL) = 'own', jak current_*_scope() w bazie (fail-closed).
  const scopeOf = (value: DataScope | null): DataScope => (isPosel ? 'all' : (value ?? 'own'));
  return {
    channel: source.channel,
    tokenId: source.tokenId,
    userId,
    userFullName: source.userFullName,
    userEmail: profile.email ?? '',
    userRole: role,
    officeId: profile.office_id ?? null,
    dataScopes: {
      cases: scopeOf(profile.scope_cases),
      contacts: scopeOf(profile.scope_contacts),
      events: scopeOf(profile.scope_events),
      interpellations: scopeOf(profile.scope_interpellations),
    },
    scopes: source.scopes,
  };
}

// Na zewnatrz zawsze ten sam komunikat (message) - powod odrzucenia (reason) tylko w logach serwera.
export class UnauthorizedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super('Nieprawidlowy, wygasly lub uniewazniony token MCP');
    this.name = 'UnauthorizedError';
    this.reason = reason;
  }
}

export function parseBearer(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1].trim() : null;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function consumeToken(token: string | null): Promise<McpAuthContext> {
  if (!token || !token.startsWith('epm_')) {
    throw new UnauthorizedError('brak lub niepoprawny format tokena');
  }

  const tokenHash = hashToken(token);
  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('mcp_consume_token', { p_token_hash: tokenHash });

  if (error) {
    console.error('[mcp] mcp_consume_token error', errorSummary(error));
    throw new UnauthorizedError('blad weryfikacji tokena');
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.user_id) {
    throw new UnauthorizedError('token nieaktywny, wygasly lub nie istnieje');
  }
  if (row.user_is_active === false) {
    throw new UnauthorizedError(`konto wlasciciela dezaktywowane (${row.user_id})`);
  }
  if (!isMcpRole(row.user_role)) {
    throw new UnauthorizedError(`rola bez dostepu do MCP (${row.user_id})`);
  }

  const profile = await loadAuthProfile(row.user_id);
  if (!profile) {
    throw new UnauthorizedError(`brak profilu wlasciciela (${row.user_id})`);
  }

  return buildAuthContext(row.user_id, row.user_role, profile, {
    channel: 'mcp',
    tokenId: row.token_id,
    userFullName: row.user_full_name ?? '',
    scopes: row.scopes ?? [],
  });
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomBytes } from 'node:crypto';
import { getServiceClient } from '../_lib/supabase.js';
import { isMcpRole, type McpRole } from '../_lib/auth.js';
import { OAUTH_TOKEN_TTL_SECONDS, parseRedirectUri, stringParam } from '../_lib/oauth.js';
import { rejectIfMcpDisabled } from '../_lib/instance.js';
import { errorSummary } from '../_lib/log-safe.js';

// Zakresy tokena wg roli wlasciciela - to samo mapowanie co create_mcp_token.
// Pracownik ma zapis interpelacji przez narzedzia submit/resubmit.
const OAUTH_TOKEN_SCOPES: Record<McpRole, string[]> = {
  posel: ['cases', 'contacts', 'events', 'interpellations', 'budget', 'audit'],
  administrator: ['cases', 'contacts', 'events', 'interpellations', 'budget', 'audit'],
  pracownik: ['cases', 'contacts', 'events', 'interpellations', 'budget_read'],
};

function sha256base64url(input: string): string {
  return createHash('sha256')
    .update(input)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function parseBasicAuth(header: string): { id: string; secret: string } | null {
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  return { id: decoded.slice(0, colon), secret: decoded.slice(colon + 1) };
}

function parseBody(req: VercelRequest): Record<string, unknown> {
  const body = req.body;
  const ct = (req.headers['content-type'] ?? '').toLowerCase();

  // Vercel auto-parsuje tylko application/json
  if (ct.includes('application/json') && typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
    return Array.isArray(body) ? {} : body as Record<string, unknown>;
  }

  // form-urlencoded: Vercel zwraca Buffer lub string
  let raw: string;
  if (Buffer.isBuffer(body)) {
    raw = body.toString('utf8');
  } else if (typeof body === 'string') {
    raw = body;
  } else if (typeof body === 'object' && body !== null) {
    // Vercel mógł sparsować jako obiekt mimo innego Content-Type
    return Array.isArray(body) ? {} : body as Record<string, unknown>;
  } else {
    return {};
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handlerInner(req, res).catch((err) => {
    console.error('[oauth/token] unhandled crash', errorSummary(err));
    try { res.status(500).json({ error: 'server_error' }); } catch { /* already sent */ }
  });
}

async function handlerInner(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  // OAuth sluzy tylko klientom MCP - bez MCP na instancji nie istnieje.
  if (rejectIfMcpDisabled(res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const body = parseBody(req);
  const grantType = body.grant_type;
  if (grantType !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  // Wyciagnij client_id + client_secret (Basic lub body)
  let clientId = stringParam(body.client_id, 200);
  let clientSecret = stringParam(body.client_secret, 200);
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const basic = parseBasicAuth(authHeader);
    if (basic) { clientId = basic.id; clientSecret = basic.secret; }
  }

  if (!clientId || !clientSecret) {
    return res.status(401).json({ error: 'invalid_client', error_description: 'Brak client_id lub client_secret' });
  }

  const code = stringParam(body.code, 200);
  const redirectUri = stringParam(body.redirect_uri);
  const codeVerifier = stringParam(body.code_verifier);

  if (!code || !redirectUri || !codeVerifier) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Brak code, redirect_uri lub code_verifier' });
  }
  // RFC 7636 §4.1: code_verifier = 43-128 znakow [A-Z a-z 0-9 - . _ ~]
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Niepoprawny code_verifier' });
  }
  if (!parseRedirectUri(redirectUri)) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Niedozwolony redirect_uri' });
  }

  const supabase = getServiceClient();

  // 1. Weryfikuj client
  const { data: clientRows, error: clientErr } = await supabase.rpc('oauth_verify_client', {
    p_client_id: clientId,
    p_client_secret: clientSecret,
  });
  if (clientErr) console.error('[oauth/token] verify client error', errorSummary(clientErr));
  const clientOwnerId: string | undefined = clientRows?.[0]?.user_id;
  if (clientErr || !clientOwnerId) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  // 2. Atomowo zuzyj kod (jednorazowy, niewygasly, przypisany do tego clienta).
  //    Kod jest spalany takze przy blednym verifierze - brak drugiej proby.
  const { data: codeRows, error: codeErr } = await supabase.rpc('oauth_consume_code', {
    p_code: code,
    p_client_id: clientId,
  });
  if (codeErr) {
    console.error('[oauth/token] consume code error', errorSummary(codeErr));
    return res.status(500).json({ error: 'server_error' });
  }
  const codeRow = Array.isArray(codeRows) ? codeRows[0] : null;
  if (!codeRow) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Nieprawidlowy, wygasly lub wykorzystany kod autoryzacyjny' });
  }
  if (codeRow.redirect_uri !== redirectUri) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri niezgodne' });
  }

  // 3. Weryfikuj PKCE
  const challenge = sha256base64url(codeVerifier);
  if (challenge !== codeRow.code_challenge) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Nieprawidlowy code_verifier' });
  }

  // 4. Kod musi nalezec do wlasciciela clienta (uzytkownik autoryzuje tylko wlasna aplikacje)
  if (codeRow.user_id !== clientOwnerId) {
    console.error('[oauth/token] code user mismatch', { clientId });
    return res.status(400).json({ error: 'invalid_grant' });
  }

  // 5. Wlasciciel musi byc nadal aktywnym Poslem lub Pracownikiem (rola mogla sie zmienic
  //    miedzy wydaniem kodu a wymiana). Zakresy tokena wynikaja z roli.
  const { data: owner, error: ownerErr } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', codeRow.user_id)
    .maybeSingle();
  if (ownerErr) {
    console.error('[oauth/token] owner profile error', errorSummary(ownerErr));
    return res.status(500).json({ error: 'server_error' });
  }
  if (!owner?.is_active || !isMcpRole(owner.role)) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Konto bez dostepu do MCP' });
  }
  const scopes = OAUTH_TOKEN_SCOPES[owner.role];

  // 6. Wygeneruj access token (epm_ format, wstaw do mcp_tokens, wazny OAUTH_TOKEN_TTL_SECONDS)
  const randomPart = randomBytes(36).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const accessToken = 'epm_' + randomPart;
  const tokenHash = createHash('sha256').update(accessToken).digest('hex');
  const tokenPrefix = randomPart.slice(0, 12);
  const expiresAt = new Date(Date.now() + OAUTH_TOKEN_TTL_SECONDS * 1000).toISOString();

  const { data: tokenRow, error: insertErr } = await supabase.from('mcp_tokens').insert({
    user_id: codeRow.user_id,
    name: `claude.ai (OAuth - ${clientId.slice(0, 12)})`,
    token_hash: tokenHash,
    token_prefix: tokenPrefix,
    oauth_client_id: clientId,
    scopes,
    expires_at: expiresAt,
  }).select('id').single();

  if (insertErr || !tokenRow) {
    console.error('[oauth/token] insert mcp_token error', errorSummary(insertErr));
    return res.status(500).json({ error: 'server_error' });
  }

  // 7. Audyt wydania tokena (bez samego tokena; prefix to etykieta widoczna w UI)
  const { error: auditErr } = await supabase.rpc('service_log_audit', {
    p_user_id: codeRow.user_id,
    p_action: 'oauth.token_issued',
    p_entity_type: 'mcp_token',
    p_entity_id: tokenRow.id,
    p_metadata: { client_id: clientId, prefix: tokenPrefix, scope: codeRow.scope, expires_at: expiresAt },
  });
  if (auditErr) {
    console.error('[oauth/token] audit error', errorSummary(auditErr));
    // Token bez wpisu w audycie nie moze trafic do klienta (fail-closed).
    await supabase.from('mcp_tokens').delete().eq('id', tokenRow.id);
    return res.status(500).json({ error: 'server_error' });
  }

  // Cleanup starych kodow (best-effort, fire-and-forget)
  // .catch() nie istnieje na PostgrestFilterBuilder — uzywamy .then(ok, err)
  supabase.rpc('oauth_cleanup_codes').then(undefined, () => null);

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: OAUTH_TOKEN_TTL_SECONDS,
    scope: codeRow.scope,
  });
}

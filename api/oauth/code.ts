// POST /api/oauth/code
// Wywoływany z poziomu strony /oauth/consent (React SPA). Weryfikuje sesję Supabase
// (Bearer token z JS klienta, wymagane aal2), klienta OAuth (musi należeć do zalogowanego użytkownika)
// i redirect_uri (ścisły walidator). Akcje (pole `action` w body):
//   - describe: zwraca nazwę klienta z bazy (do wyświetlenia na ekranie zgody)
//   - approve (domyślnie): generuje authorization code i zwraca URL callbacku
//   - deny: zwraca URL callbacku z error=access_denied
// Frontend robi window.location.href wyłącznie na zwrócony stąd redirect_url.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'node:crypto';
import { getAnonClient, getServiceClient } from '../_lib/supabase.js';
import { isAal2Session } from '../_lib/jwt.js';
import { isMcpRole } from '../_lib/auth.js';
import { CODE_CHALLENGE_S256_RE, parseRedirectUri, stringParam } from '../_lib/oauth.js';
import { getSiteIdentity, mpForms } from '../_lib/siteIdentity.js';
import { rejectIfAiDisabled } from '../_lib/instance.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handlerInner(req, res).catch((err) => {
    console.error('[oauth/code] unhandled crash', err);
    try { res.status(500).json({ error: 'server_error' }); } catch { /* already sent */ }
  });
}

async function handlerInner(req: VercelRequest, res: VercelResponse) {
  // OAuth sluzy tylko klientom MCP (Claude) - bez AI na instancji nie istnieje.
  if (rejectIfAiDisabled(res)) return;
  // Bez CORS: wolany tylko z SPA na tym samym originie (sesja Supabase), obce strony nie czytaja odpowiedzi.
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // 1. Zweryfikuj sesję Supabase (Bearer token z JS klienta frontendowego)
  const authHeader = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) {
    return res.status(401).json({ error: 'unauthorized', error_description: 'Brak Bearer tokena sesji' });
  }
  const sessionToken = match[1];

  const { data: { user }, error: userErr } = await getAnonClient().auth.getUser(sessionToken);
  if (userErr || !user) {
    return res.status(401).json({ error: 'unauthorized', error_description: 'Nieprawidłowa sesja' });
  }

  // 2. Sprawdz ze to aktywny Posel lub Pracownik (role MCP) z sesją po drugim składniku (aal2)
  const supabase = getServiceClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.is_active || !isMcpRole(profile.role)) {
    const mp = mpForms((await getSiteIdentity()).mp_gender);
    return res.status(403).json({
      error: 'access_denied',
      error_description: `Tylko ${mp.nominative}, Administrator lub Pracownik może autoryzować dostęp Claude do portalu biura`,
    });
  }
  if (!isAal2Session(sessionToken, user)) {
    return res.status(403).json({
      error: 'access_denied',
      error_description: 'Wymagana weryfikacja dwuetapowa (2FA)',
    });
  }

  // 3. Waliduj parametry z body
  const body: Record<string, unknown> =
    typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body) ? req.body : {};
  const action = body.action ?? 'approve';
  if (action !== 'describe' && action !== 'approve' && action !== 'deny') {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Nieznana akcja' });
  }
  const clientId = stringParam(body.client_id, 200);
  const redirectUri = stringParam(body.redirect_uri);
  const state = stringParam(body.state);

  if (!clientId || !redirectUri) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Brak wymaganych parametrów' });
  }
  const callbackUrl = parseRedirectUri(redirectUri);
  if (!callbackUrl) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Niedozwolony redirect_uri' });
  }

  // 4. Sprawdz client (musi istnieć, nie być unieważniony i należeć do zalogowanego użytkownika)
  const { data: client, error: clientErr } = await supabase
    .from('oauth_clients')
    .select('client_id, name, revoked_at')
    .eq('client_id', clientId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (clientErr) {
    console.error('[oauth/code] client lookup error', clientErr);
    return res.status(500).json({ error: 'server_error' });
  }
  if (!client || client.revoked_at) {
    return res.status(400).json({ error: 'invalid_client', error_description: 'Nieznana lub unieważniona aplikacja' });
  }

  if (action === 'describe') {
    return res.status(200).json({ client_name: client.name });
  }

  if (action === 'deny') {
    callbackUrl.searchParams.set('error', 'access_denied');
    callbackUrl.searchParams.set('error_description', 'Użytkownik odmówił dostępu');
    if (state) callbackUrl.searchParams.set('state', state);
    return res.status(200).json({ redirect_url: callbackUrl.toString() });
  }

  const codeChallenge = stringParam(body.code_challenge);
  const codeChallengeMethod = body.code_challenge_method === undefined ? 'S256' : body.code_challenge_method;
  const scope = body.scope === undefined ? 'mcp' : stringParam(body.scope, 200);
  if (codeChallengeMethod !== 'S256' || !CODE_CHALLENGE_S256_RE.test(codeChallenge)) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Wymagany code_challenge (PKCE S256)' });
  }
  if (!scope) {
    return res.status(400).json({ error: 'invalid_scope' });
  }

  // 5. Generuj authorization code
  const code = 'epc_' + randomBytes(24).toString('base64url');

  const { error: insertErr } = await supabase.from('oauth_codes').insert({
    code,
    client_id: clientId,
    user_id: user.id,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    scope,
  });

  if (insertErr) {
    console.error('[oauth/code] insert error', insertErr);
    return res.status(500).json({ error: 'server_error' });
  }

  // Audyt wydania kodu (bez samego kodu i code_challenge)
  const { error: auditErr } = await supabase.rpc('service_log_audit', {
    p_user_id: user.id,
    p_action: 'oauth.code_issued',
    p_entity_type: 'oauth_client',
    p_entity_id: null,
    p_metadata: { client_id: clientId, redirect_host: callbackUrl.host, scope },
  });
  if (auditErr) {
    console.error('[oauth/code] audit error', auditErr);
    // Bez wpisu w audycie kod nie moze zostac uzyty - usuwamy go (fail-closed).
    await supabase.from('oauth_codes').delete().eq('code', code);
    return res.status(500).json({ error: 'server_error' });
  }

  // 6. Zwroc redirect URL (frontend sam robi window.location.href)
  callbackUrl.searchParams.set('code', code);
  if (state) callbackUrl.searchParams.set('state', state);

  res.status(200).json({ redirect_url: callbackUrl.toString() });
}

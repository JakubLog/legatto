import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceClient } from '../_lib/supabase.js';
import { CODE_CHALLENGE_S256_RE, parseRedirectUri, stringParam } from '../_lib/oauth.js';
import { resolveIssuer } from '../_lib/issuer.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handlerInner(req, res).catch((err) => {
    console.error('[oauth/authorize] unhandled crash', err);
    try { res.status(500).send('Blad serwera'); } catch { /* already sent */ }
  });
}

async function handlerInner(req: VercelRequest, res: VercelResponse) {
  // Bez CORS: klient OAuth przychodzi tu nawigacja przegladarki (redirect), nie fetch z obcego originu -
  // obca strona nie odczyta odpowiedzi (np. czy dany client_id istnieje).
  if (req.method !== 'GET') return res.status(405).end();

  const q = req.query as Record<string, unknown>;
  const clientId = stringParam(q.client_id, 200);
  const redirectUri = stringParam(q.redirect_uri);
  const responseType = stringParam(q.response_type);
  const codeChallenge = stringParam(q.code_challenge);
  const codeChallengeMethod = q.code_challenge_method === undefined ? 'S256' : stringParam(q.code_challenge_method);
  const state = stringParam(q.state);
  const scope = q.scope === undefined ? 'mcp' : stringParam(q.scope, 200);

  if (!clientId) return res.status(400).send('Brak client_id');
  if (responseType !== 'code') return res.status(400).send('Wymagany response_type=code');
  if (codeChallengeMethod !== 'S256' || !CODE_CHALLENGE_S256_RE.test(codeChallenge)) {
    return res.status(400).send('Wymagany code_challenge (PKCE S256)');
  }
  if (!parseRedirectUri(redirectUri)) {
    return res.status(400).send('Niedozwolony redirect_uri');
  }

  // Sprawdz czy client istnieje
  const supabase = getServiceClient();
  const { data: client } = await supabase
    .from('oauth_clients')
    .select('client_id, revoked_at')
    .eq('client_id', clientId)
    .maybeSingle();

  if (!client || client.revoked_at) {
    return res.status(400).send('Nieznany lub unieważniony client_id');
  }

  // Redirect na stronę consent w React SPA (z aktywna sesja Supabase).
  // Nazwa klienta NIE idzie w URL - strona zgody pobiera ja z serwera po client_id.
  const consentParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    state,
    scope,
  });

  // Strona zgody zawsze na kanonicznym adresie instancji (OAUTH_ISSUER albo host żądania).
  res.redirect(302, `${resolveIssuer(req)}/oauth/consent?${consentParams.toString()}`);
}

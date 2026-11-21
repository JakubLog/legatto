import type { VercelRequest, VercelResponse } from '@vercel/node';
import { IssuerError, resolveIssuer } from '../_lib/issuer.js';
import { rejectIfAiDisabled } from '../_lib/instance.js';

// MCP OAuth 2.0 Authorization Server Metadata (RFC 8414)
// Serwowany pod /.well-known/oauth-authorization-server przez rewrite w vercel.json.
// INSTANCE_AI != on: 404 AI_DISABLED - instancja bez AI nie oglasza serwera OAuth.

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (rejectIfAiDisabled(res)) return;
  let issuer: string;
  try {
    issuer = resolveIssuer(req);
  } catch (err) {
    if (!(err instanceof IssuerError)) throw err;
    console.error('[oauth/discovery]', err.message);
    return res.status(500).json({ error: 'server_error', error_description: err.message });
  }
  res.status(200).json({
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    scopes_supported: ['mcp'],
    service_documentation: `${issuer}/biuro/admin/integracje`,
    logo_uri: `${issuer}/favicon.svg`,
  });
}

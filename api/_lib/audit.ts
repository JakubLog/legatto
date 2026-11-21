import { getServiceClient } from './supabase.js';
import type { McpAuthContext } from './auth.js';

/** Metadane wpisu audytu MCP/PoliAI: przekazane pola + token_id i kanal wywolania. */
export function auditMetadata(ctx: McpAuthContext, metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...metadata,
    ...(ctx.tokenId ? { token_id: ctx.tokenId } : {}),
    ...(ctx.channel !== 'mcp' ? { via: ctx.channel } : {}),
  };
}

// Zwraca true, gdy wpis trafil do audit_log. Przy bledzie loguje do konsoli i zwraca
// false - wolajacy decyduje, czy przerwac operacje (mcp.tool_call przed handlerem
// przerywa, patrz api/mcp.ts). Kanal 'portal' (operacje portalu bez AI) idzie przez
// service_log_audit - bez znacznika via_mcp, ktory mcp_log_audit dokleja kazdemu wpisowi.
export async function logAudit(
  ctx: McpAuthContext,
  action: string,
  options: {
    entityType?: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<boolean> {
  const supabase = getServiceClient();
  const { error } = await supabase.rpc(ctx.channel === 'portal' ? 'service_log_audit' : 'mcp_log_audit', {
    p_user_id: ctx.userId,
    p_action: action,
    p_entity_type: options.entityType ?? null,
    p_entity_id: options.entityId ?? null,
    p_metadata: auditMetadata(ctx, options.metadata),
  });
  if (error) {
    console.error('[mcp] audit log error', error);
    return false;
  }
  return true;
}

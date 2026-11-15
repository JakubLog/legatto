import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { McpToken } from '@/integrations/supabase/types';

export function useMcpTokens() {
  return useQuery<McpToken[]>({
    queryKey: ['mcp-tokens'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mcp_tokens')
        .select('id, user_id, name, token_prefix, scopes, last_used_at, created_at, revoked_at, expires_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as McpToken[];
    },
    staleTime: 30_000,
  });
}

// Ważność ręcznego tokena w dniach (create_mcp_token przyjmuje 1-180, domyślnie 90).
export const MCP_TOKEN_LIFETIMES = [30, 90, 180] as const;
export type McpTokenLifetime = (typeof MCP_TOKEN_LIFETIMES)[number];

export function useCreateMcpToken() {
  const qc = useQueryClient();
  return useMutation<string, Error, { name: string; days: McpTokenLifetime }>({
    mutationFn: async ({ name, days }) => {
      const { data, error } = await supabase.rpc('create_mcp_token', { p_name: name, p_days: days });
      if (error) throw error;
      if (typeof data !== 'string' || !data.startsWith('epm_')) {
        throw new Error('Niepoprawna odpowiedz serwera (oczekiwano tokena epm_...)');
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp-tokens'] });
    },
  });
}

export function useRevokeMcpToken() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (tokenId) => {
      const { error } = await supabase.rpc('revoke_mcp_token', { p_token_id: tokenId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp-tokens'] });
    },
  });
}

export function useDeleteMcpToken() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (tokenId) => {
      const { error } = await supabase.rpc('delete_mcp_token', { p_token_id: tokenId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp-tokens'] });
    },
  });
}

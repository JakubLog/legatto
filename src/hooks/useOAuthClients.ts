import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface OAuthClient {
  client_id: string;
  user_id: string;
  name: string;
  client_secret_prefix: string;
  created_at: string;
  revoked_at: string | null;
}

export interface OAuthClientCreated {
  client_id: string;
  client_secret: string;
}

export function useOAuthClients() {
  return useQuery<OAuthClient[]>({
    queryKey: ['oauth-clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('oauth_clients')
        .select('client_id, user_id, name, client_secret_prefix, created_at, revoked_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as OAuthClient[];
    },
    staleTime: 30_000,
  });
}

export function useCreateOAuthClient() {
  const qc = useQueryClient();
  return useMutation<OAuthClientCreated, Error, { name: string }>({
    mutationFn: async ({ name }) => {
      const { data, error } = await supabase.rpc('create_oauth_client', { p_name: name });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.client_id || !row?.client_secret) {
        throw new Error('Niepoprawna odpowiedz serwera');
      }
      return { client_id: row.client_id, client_secret: row.client_secret };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['oauth-clients'] });
    },
  });
}

export function useRevokeOAuthClient() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (clientId) => {
      const { error } = await supabase.rpc('revoke_oauth_client', { p_client_id: clientId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['oauth-clients'] });
    },
  });
}

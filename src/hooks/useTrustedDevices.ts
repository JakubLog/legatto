import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { removeRememberedProfile } from '@/lib/trustedDevice';

export interface TrustedDevice {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
}

const TRUSTED_DEVICES_KEY = ['trusted-devices'] as const;

/** Zaufane przeglądarki zalogowanego użytkownika (logowanie PIN-em + 2FA z ekranu wyboru profilu). */
export function useTrustedDevices() {
  return useQuery<TrustedDevice[]>({
    queryKey: TRUSTED_DEVICES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_my_trusted_devices');
      if (error) throw error;
      return (data ?? []) as TrustedDevice[];
    },
    staleTime: 30_000,
  });
}

/**
 * Odwołanie zaufania. Dla tego komputera (`thisComputerUserId`) profil znika też z ekranu wyboru -
 * inaczej zapamiętany profil po odświeżeniu karty zarejestrowałby nowy klucz.
 */
export function useRevokeTrustedDevice() {
  const qc = useQueryClient();
  return useMutation<void, Error, { deviceId: string; thisComputerUserId: string | null }>({
    mutationFn: async ({ deviceId, thisComputerUserId }) => {
      const { error } = await supabase.rpc('revoke_trusted_device', { p_id: deviceId });
      if (error) throw error;
      if (thisComputerUserId) await removeRememberedProfile(thisComputerUserId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TRUSTED_DEVICES_KEY });
    },
  });
}

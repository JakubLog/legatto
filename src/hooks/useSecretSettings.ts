import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Sekretne klucze integracji (app_settings) nigdy nie trafiaja do przegladarki.
// Odczyt: tylko status + koncowka klucza (get_secret_settings_status), zapis: set_secret_setting.
// Oba RPC: Posel, aktywne konto, aal2.

export type SecretSettingKey = 'anthropic_api_key' | 'getresponse_api_key' | 'resend_api_key';

export interface SecretSettingStatus {
  configured: boolean;
  /** Np. '••••abcd'; null gdy klucz nie jest ustawiony. */
  hint: string | null;
}

export type SecretSettingsStatus = Record<SecretSettingKey, SecretSettingStatus>;

export const SECRET_SETTINGS_STATUS_KEY = ['secret-settings-status'] as const;

const NOT_CONFIGURED: SecretSettingStatus = { configured: false, hint: null };

export function useSecretSettingsStatus() {
  return useQuery<SecretSettingsStatus>({
    queryKey: SECRET_SETTINGS_STATUS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_secret_settings_status');
      if (error) throw error;
      const out: SecretSettingsStatus = {
        anthropic_api_key: NOT_CONFIGURED,
        getresponse_api_key: NOT_CONFIGURED,
        resend_api_key: NOT_CONFIGURED,
      };
      for (const row of (data ?? []) as { key: string; configured: boolean; hint: string | null }[]) {
        if (row.key === 'anthropic_api_key' || row.key === 'getresponse_api_key' || row.key === 'resend_api_key') {
          out[row.key] = { configured: row.configured, hint: row.hint };
        }
      }
      return out;
    },
    staleTime: 5 * 60_000,
  });
}

/** Pusty / null value usuwa klucz (integracja nieskonfigurowana). */
export async function saveSecretSetting(key: SecretSettingKey, value: string | null): Promise<void> {
  const trimmed = value?.trim() ?? '';
  const { error } = await supabase.rpc('set_secret_setting', {
    p_key: key,
    p_value: trimmed === '' ? null : trimmed,
  });
  if (error) throw error;
}

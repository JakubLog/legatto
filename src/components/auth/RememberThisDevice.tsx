import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { syncRememberedProfile } from '@/lib/trustedDevice';

/**
 * Montowany w ProtectedRoute po przejściu 2FA (aal2): zapamiętuje profil na ekranie wyboru
 * i rejestruje zaufanie tej przeglądarki (szczegóły: src/lib/trustedDevice.ts).
 * Reaguje też na ustawienie / usunięcie PIN-u oraz zmianę imienia lub avatara.
 */
export function RememberThisDevice() {
  const { profile } = useAuth();

  useEffect(() => {
    if (profile) void syncRememberedProfile(profile);
    // Zależności: tylko pola zapisywane w profilu na ekranie wyboru i PIN.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.full_name, profile?.avatar_url, profile?.updated_at, profile?.has_privacy_pin]);

  return null;
}

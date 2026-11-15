import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Blokada po 5 nieudanych probach (liczona w DB: 15 min, przy powtarzających się blokadach
 * w ciągu doby - 24 h) - RPC rzuca 'privacy_pin_locked'.
 */
export class PrivacyPinLockedError extends Error {
  constructor() {
    super('Zbyt wiele nieudanych prób podania PIN-u. PIN jest zablokowany na 15 minut, a po kolejnych blokadach na 24 godziny.');
    this.name = 'PrivacyPinLockedError';
  }
}

const PIN_ERROR_MESSAGES: Record<string, string> = {
  privacy_pin_format: 'PIN musi mieć od 4 do 8 cyfr.',
  privacy_pin_current_required: 'Podaj obecny PIN.',
  privacy_pin_not_set: 'PIN trybu prywatnego nie jest ustawiony.',
};

function toPinError(error: { message: string }): Error {
  if (error.message.includes('privacy_pin_locked')) return new PrivacyPinLockedError();
  return new Error(PIN_ERROR_MESSAGES[error.message] ?? error.message);
}

async function verifyPin(pin: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verify_my_privacy_pin', { p_pin: pin });
  if (error) throw toPinError(error);
  return Boolean(data);
}

// set/clear z blednym obecnym PIN-em koncza sie w DB bez wyjatku (zapisuja tylko nieudana probe),
// wiec obecny PIN weryfikujemy najpierw przez verify_my_privacy_pin - tez liczone do blokady.
async function requireCurrentPin(currentPin: string): Promise<void> {
  if (!(await verifyPin(currentPin))) throw new Error('Niepoprawny obecny PIN.');
}

export function useSetPrivacyPin() {
  const { refreshProfile } = useAuth();
  return useMutation({
    // currentPin wymagany, gdy PIN jest juz ustawiony (zmiana PIN-u).
    mutationFn: async ({ pin, currentPin }: { pin: string; currentPin?: string }) => {
      if (currentPin !== undefined) await requireCurrentPin(currentPin);
      const { error } = await supabase.rpc('set_my_privacy_pin', {
        p_pin: pin,
        p_current_pin: currentPin ?? null,
      });
      if (error) throw toPinError(error);
    },
    onSuccess: () => refreshProfile(),
  });
}

export function useVerifyPrivacyPin() {
  return useMutation({ mutationFn: verifyPin });
}

export function useClearPrivacyPin() {
  const { refreshProfile } = useAuth();
  return useMutation({
    mutationFn: async (currentPin: string) => {
      await requireCurrentPin(currentPin);
      const { error } = await supabase.rpc('clear_my_privacy_pin', { p_current_pin: currentPin });
      if (error) throw toPinError(error);
    },
    onSuccess: () => refreshProfile(),
  });
}

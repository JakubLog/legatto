import { useMutation } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface SubmitPayload {
  reporter_name: string;
  reporter_email?: string | null;
  reporter_phone?: string | null;
  powiat_id: number;
  gmina_id?: number | null;
  category_id: number;
  title: string;
  description: string;
  rodo_consent: true;
  consent_newsletter?: boolean;
  consent_contacts_db?: boolean;
  website?: string;
  /** Token Cloudflare Turnstile - weryfikowany przez public-submit-case (TURNSTILE_SECRET). */
  turnstile_token: string;
}

interface SubmitResponse {
  success: true;
  case_id: string;
}

export function useSubmitPublicCase() {
  return useMutation<SubmitResponse, Error, SubmitPayload>({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.functions.invoke<SubmitResponse>(
        'public-submit-case',
        { body: payload },
      );
      if (error) {
        // FunctionsHttpError - serwer zwrocil non-2xx; body dostepne przez context.json()
        if (error instanceof FunctionsHttpError) {
          try {
            const body = (await error.context.json()) as { error?: string };
            if (body?.error) throw new Error(body.error);
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message) throw parseErr;
            // ignore - fallback do generic
          }
        }
        throw new Error(error.message || 'Nie udało się wysłać zgłoszenia');
      }
      if (!data || data.success !== true) {
        throw new Error('Nieoczekiwana odpowiedź serwera');
      }
      return data;
    },
  });
}

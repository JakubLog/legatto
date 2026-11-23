import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { TURNSTILE_SITE_KEY } from '@/components/public/TurnstileWidget';
import { SubmissionError, type SubmissionStrategy } from '@/lib/publicSubmission';

// Strategia formularza zgłoszeń dla SPA (tryb Vercel/Supabase Cloud, do końca migracji instancji):
// funkcja brzegowa public-submit-case (walidacja, Turnstile z TURNSTILE_SECRET, limit, insert sprawy).
// Osobny moduł, bo importuje klienta Supabase - nie może trafić do bundla strony statycznej.

interface EdgeResponse {
  success: true;
  case_id: string;
}

export const edgeSubmissionStrategy: SubmissionStrategy = {
  turnstileSiteKey: TURNSTILE_SITE_KEY,
  async submit(form, turnstileToken, honeypot) {
    const { data, error } = await supabase.functions.invoke<EdgeResponse>('public-submit-case', {
      body: { ...form, website: honeypot, turnstile_token: turnstileToken },
    });
    if (error) {
      // FunctionsHttpError - serwer zwrócił non-2xx; komunikat po polsku w body.error.
      if (error instanceof FunctionsHttpError) {
        const body = (await error.context.json().catch(() => null)) as { error?: unknown } | null;
        if (typeof body?.error === 'string' && body.error) throw new SubmissionError(body.error);
      }
      throw new SubmissionError('Nie udało się wysłać zgłoszenia. Spróbuj ponownie później.');
    }
    if (!data || data.success !== true) throw new SubmissionError('Nieoczekiwana odpowiedź serwera.');
    return { ref: null };
  },
};

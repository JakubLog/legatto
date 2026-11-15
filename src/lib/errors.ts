import { FunctionsHttpError } from '@supabase/supabase-js';

/**
 * Wyciaga czytelna wiadomosc z dowolnego wyjatku.
 *
 * Supabase nie zawsze zwraca instancje `Error` - PostgrestError, FunctionsError
 * i StorageError to czasami zwykle obiekty `{ code, message, details, hint }`.
 * Stary wzor `err instanceof Error ? err.message : 'Nieznany blad'` w takich
 * przypadkach pokazywal niepomocny fallback. Ten helper probuje wszystkich
 * sensownych zrodel po kolei.
 */
export function errorMessage(err: unknown, fallback = 'Nieznany błąd'): string {
  if (err === null || err === undefined) return fallback;
  if (typeof err === 'string') return err || fallback;

  if (err instanceof Error && err.message) {
    return err.message;
  }

  if (typeof err === 'object') {
    const obj = err as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
      error_description?: unknown;
    };

    const parts: string[] = [];
    if (typeof obj.message === 'string' && obj.message.trim()) parts.push(obj.message.trim());
    if (typeof obj.details === 'string' && obj.details.trim()) parts.push(obj.details.trim());
    if (typeof obj.hint === 'string' && obj.hint.trim()) parts.push(`(${obj.hint.trim()})`);
    if (parts.length > 0) return parts.join(' - ');

    if (typeof obj.error_description === 'string' && obj.error_description.trim()) {
      return obj.error_description.trim();
    }
    if (typeof obj.code === 'string' && obj.code.trim()) {
      return `Kod błędu: ${obj.code.trim()}`;
    }
  }

  return fallback;
}

/**
 * Błąd `supabase.functions.invoke`. Przy odpowiedzi non-2xx supabase-js daje tylko ogólny
 * komunikat ("non-2xx status code"), a Edge Functions zwracają polski powód w body `{ error }`.
 */
export async function functionErrorMessage(err: unknown): Promise<string> {
  if (err instanceof FunctionsHttpError) {
    const body = (await err.context.json().catch(() => null)) as { error?: unknown } | null;
    if (typeof body?.error === 'string' && body.error.trim()) return body.error.trim();
  }
  return errorMessage(err);
}

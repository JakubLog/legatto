import { isAuthError } from '@supabase/supabase-js';
import { z } from 'zod';

// Polityka haseł = konfiguracja Supabase Auth (password_min_length, password_required_characters
// "abc…:ABC…:0-9:symbole"). Zestaw znaków specjalnych jak w GoTrue - inne (np. spacja, "ą")
// serwer nie liczy jako symbol.
export const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_SYMBOL = /[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/;

export const PASSWORD_HINT =
  'Min. 12 znaków, w tym mała i wielka litera, cyfra oraz znak specjalny (np. ! ? # @).';

/** Nowe hasło + powtórzenie (ustawienie hasła po zaproszeniu, zmiana w profilu). */
export const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Hasło musi mieć min. ${PASSWORD_MIN_LENGTH} znaków`)
      .regex(/[a-z]/, 'Min. 1 mała litera (a-z)')
      .regex(/[A-Z]/, 'Min. 1 wielka litera (A-Z)')
      .regex(/\d/, 'Min. 1 cyfra')
      .regex(PASSWORD_SYMBOL, 'Min. 1 znak specjalny, np. ! ? # @ - _'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Hasła muszą być takie same',
  });
export type NewPasswordValues = z.infer<typeof newPasswordSchema>;

/** GoTrue (security_update_password_require_reauthentication): sesja starsza niż 24 h wymaga kodu z e-maila. */
export function isReauthenticationNeeded(err: unknown): boolean {
  return isAuthError(err) && (err.code === 'reauthentication_needed' || err.code === 'reauth_nonce_missing');
}

/** Błąd `auth.updateUser({ password })` / `auth.reauthenticate()` po polsku (GoTrue zwraca komunikaty po angielsku). */
export function passwordErrorMessage(err: unknown): string {
  const code = isAuthError(err) ? err.code : undefined;
  if (code === 'weak_password') return `Hasło jest za słabe. ${PASSWORD_HINT}`;
  if (code === 'same_password') return 'Nowe hasło musi różnić się od obecnego.';
  if (isReauthenticationNeeded(err)) {
    return 'Zmiana hasła wymaga ponownego potwierdzenia tożsamości. Wyloguj się i zaloguj ponownie albo poproś o nowy link.';
  }
  if (code === 'reauthentication_not_valid') return 'Kod potwierdzający jest nieprawidłowy lub wygasł. Wyślij nowy kod.';
  if (code === 'over_email_send_rate_limit') return 'Wysłano zbyt wiele e-maili. Spróbuj ponownie za kilka minut.';
  return err instanceof Error ? err.message : 'Nieznany błąd';
}

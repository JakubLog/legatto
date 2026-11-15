// Link `mailto:` z danych użytkownika (formularz publiczny, import kontaktów).
// Adres trafia do linku tylko, gdy jest prostym adresem: bez `?`/`&` (parametry
// cc/bcc/subject/body z RFC 6068), `%` (zakodowane znaki), białych znaków,
// przecinków/średników (lista adresów) i z dokładnie jednym `@`.
// Dla innej wartości helper zwraca null - wywołujący pokazuje adres jako tekst.
const PLAIN_EMAIL = /^[A-Za-z0-9._+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function mailtoHref(email: string | null | undefined): string | null {
  const value = (email ?? '').trim();
  if (value.length === 0 || value.length > 254 || !PLAIN_EMAIL.test(value)) return null;
  const at = value.indexOf('@');
  // Część lokalna kodowana (np. `+` jako %2B, żeby klient poczty nie zamienił go na spację).
  return `mailto:${encodeURIComponent(value.slice(0, at))}@${value.slice(at + 1)}`;
}

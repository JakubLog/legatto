// Sprawdzenie sesji aal2 (C7: endpointy uprzywilejowane wymagaja drugiego skladnika), spojne
// z is_aal2() w bazie: claim `aal` = 'aal2' w JWT ORAZ zweryfikowany czynnik MFA uzytkownika.
// UWAGA: claim czytamy bez weryfikacji podpisu - wolac WYLACZNIE z uzytkownikiem zwroconym
// przez auth.getUser(jwt), ktory waliduje token po stronie Supabase Auth. Lista `factors`
// pochodzi z tej samej odpowiedzi (GoTrue GET /user), wiec sprawdzenie nie kosztuje dodatkowego
// zapytania. Uzytkownik, ktory usunal swoj czynnik, zachowuje JWT z aal2 do wygasniecia - baza
// go juz odrzuca (is_aal2), API tez.
// Unieważnienie sesji (wyloguj wszędzie, dezaktywacja): GoTrue GET /user (auth.getUser) odrzuca
// JWT, którego session_id nie ma już w auth.sessions (błąd `session_not_found`), więc endpointy
// z getUser przed tym helperem nie przepuszczą odwołanej sesji - tu nie trzeba tego powtarzać.
export interface SessionUser {
  id: string;
  factors?: ReadonlyArray<{ status: string }> | null;
}

export function isAal2Session(jwt: string, user: SessionUser): boolean {
  if (!user?.factors?.some((f) => f.status === 'verified')) return false;
  const payload = jwt.split('.')[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    return claims.sub === user.id && claims.aal === 'aal2';
  } catch {
    return false;
  }
}

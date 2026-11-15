# Legatto - Reguły Bezpieczeństwa

> 20+ reguł bezpieczeństwa dla Vite SPA + Supabase. Czytaj przed praca z auth, inputami, API, danymi użytkowników.

---

## Supabase & RLS (#1-4)

### #1 RLS na każdej tabeli z danymi biura
- KAŻDE zapytanie klienta filtrowane przez RLS (rola, `is_aal2()`, `data_scope`)
- NIGDY bypass RLS w kliencie (service_role key TYLKO w Edge Functions i `api/`)
- Policy coverage: SELECT, INSERT, UPDATE, DELETE

### #2 Izolacja instancji i zakres danych
- Jedna instancja = jeden poseł (ADR 026): dane biur różnych posłów są w osobnych projektach Supabase, bez `tenant_id`
- Widoczność rekordów w instancji: role + `data_scope` (`current_*_scope()`, ADR 016); kod na service_role odtwarza to przez `applyDataScope` (`api/_lib/access.ts`)

### #3 Kaskadowe usuwanie
- CASCADE deletes na foreign keys dla spójności danych
- Nigdy nie zostawiaj osieroconych rekordów (także plików w Storage - kosz i crony sprzątają)

### #4 Atomowe operacje
- RPC zamiast multi-step (check → insert), np. limity, zmiany statusów, `set_module_owners`
- Upsert zamiast check-then-insert (race conditions)

---

## Auth (#5-7)

### #5 Auth check na poczatku każdej operacji
- useAuth() hook w komponentach
- supabase.auth.getUser() w Edge Functions
- NIGDY nie ufaj session z localStorage - ZAWSZE weryfikuj server-side

### #6 Token refresh automatyczny
- Supabase client obsługuje automatycznie
- Nie implementuj własnego token management

### #7 Logout = pełny cleanup
- signOut()
- Wyczyść dane klienta: cache React Query (`queryClient.clear()`), "Ostatnie" wyszukiwarki (`clearRecent()`) - także przy zmianie usera w tej samej karcie (`AuthContext`) - i szkice newslettera (`clearNewsletterDrafts()`, tylko przy jawnym wylogowaniu)
- Zdejmij blokadę trybu prywatnego (`setPrivacyLocked(userId, false)`)
- Redirect na `/`

---

## Walidacja (#8-10)

### #8 Formularze → Zod schema
- react-hook-form + zodResolver
- NIGDY nie ufaj formData bez walidacji
- .parse() (throw on error) w Edge Functions
- .safeParse() w UI (graceful error display)

### #9 Edge Functions → server-side validation
```typescript
const { data: { user }, error } = await supabaseClient.auth.getUser()
if (error || !user) return new Response('Unauthorized', { status: 401 })

const parsed = schema.safeParse(body)
if (!parsed.success) return new Response('Invalid input', { status: 400 })
```

### #10 Upload validation
- Limity rozmiaru i typy MIME wymuszone na bucketach Storage (`file_size_limit`, `allowed_mime_types`; lista: `infrastructure/database.md` → "Storage buckety")
- Klient sprawdza to samo przed wysłaniem (komunikat zamiast błędu serwera)
- Ścieżka pliku w folderze rekordu nadrzędnego (polityki Storage sprawdzają widoczność rodzica)

---

## Sekrety (#11-13)

### #11 Zmienne środowiskowe
- `VITE_*` = PUBLICZNE (widoczne w kliencie)
- Supabase anon key = publiczny (RLS chroni dane)
- `SUPABASE_SERVICE_ROLE_KEY` = NIGDY w kliencie, TYLKO w Edge Functions

### #12 Nigdy nie commituj
- .env, .env.local
- API keys, tokeny
- service_role key

### #13 import.meta.env
- Vite używa `import.meta.env.VITE_*` (NIE process.env)
- Brak type-safe env validation (TODO: dodac)

---

## Select bezpieczeństwo (#14-15)

### #14 Explicit columns
```typescript
// DOBRZE
.select('id, name, amount, created_at')

// ZLE - nigdy na sensitive data
.select('*')
```

### #15 DTO pattern w hookach
- Hooki definiują explicit kolumny w .select()
- Nie zwracaj więcej niż potrzeba dla UI

---

## Logowanie & Privacy (#16-18)

### #16 NIGDY nie loguj PII
- E-maile, imiona, dane wyborców, IP, tokeny → NIGDY w `console.log` / `console.error`
- Logi serwera: identyfikatory i kody błędów, nie treść rekordów

### #17 Dane osobowe wyborców
- Zgłoszenia publiczne: IP tylko jako hash SHA-256 z solą `PUBLIC_SUBMISSION_IP_SALT`, zgody marketingowe jako jawne kolumny
- Tryb prywatny (PIN) zasłania ekran portalu na współdzielonym urządzeniu

### #18 RODO compliance
- Dane wyborców i kontaktów = dane osobowe; przechowuj minimum niezbędnych danych
- Usunięte rekordy: kosz 7 dni, potem trwale razem z plikami
- Administratorem danych jest poseł danej instancji (stopka newslettera, formularz publiczny)

---

## Frontend (#19-20)

### #19 Nie eksponuj błędów DB
- Błędy bazy → ogólny komunikat w UI ("Coś poszło nie tak")
- Szczegóły → `console.error` bez PII

### #20 Zaproszenia i linki logowania
- Konta zakłada wyłącznie Poseł/Administrator przez Edge Function `admin-create-user` (rejestracja wyłączona, ADR 002)
- Linki zaproszeń i odzyskiwania generuje Supabase Auth (jednorazowe, z wygaśnięciem); jedyny dozwolony redirect = `AUTH_REDIRECT_URL`

---

## Portal biura - utwardzenie po audycie (#21-26)

### #21 aal2 wszędzie, gdzie RLS nie działa
- Edge Functions i Vercel działają na service_role - RLS (`is_aal2()`) ich nie chroni
- Edge Functions: `isCallerAal2` z `supabase/functions/_shared/auth.ts` (fail-closed); Vercel: `isAal2Session` z `api/_lib/jwt.ts` po `auth.getUser(jwt)`
- RPC SECURITY DEFINER dla Posła sprawdzają `is_aal2()` wewnątrz

### #22 Sekrety nigdy w przeglądarce
- Klucze API (`anthropic_api_key`, `getresponse_api_key`, `resend_api_key`) i prywatny klucz VAPID zaszyfrowane w Supabase Vault (migracja `20261110170000_secrets_vault.sql`); CHECK `app_settings_no_plaintext_secrets` nie wpuszcza ich do `app_settings`. Zapis `set_secret_setting`, status `get_secret_settings_status` (`src/hooks/useSecretSettings.ts`), odczyt tylko service_role przez `service_get_secrets`
- Hash PIN-u trybu prywatnego tylko w `profile_secrets` (RLS bez polityk, brak grantów); na `profiles` jedynie `has_privacy_pin`
- Limity prób (PIN: 5 → blokada 15 min) wyłącznie po stronie DB, nie w UI

### #23 Audyt nie do podrobienia
- `log_audit` nie jest wykonywalne przez `authenticated` - tylko triggery/RPC SECURITY DEFINER i service_role
- Frontend: `log_client_event` (allow-lista MFA); serwer: `service_log_audit`; MCP: `mcp_log_audit`
- Wartości sekretów nie trafiają do `audit_log` (maskowanie w `app_settings_audit_trigger`)

### #24 Atomowe operacje jednorazowe
- Kod OAuth: `oauth_consume_code` (UPDATE z warunkiem), nigdy check → update
- Limit publicznego formularza: `claim_public_submission_slot` (advisory lock)
- `created_by` ustawia trigger `set_created_by` (INSERT = `auth.uid()`, UPDATE = niezmienne)

### #25 Pobieranie URL-i od użytkownika = SSRF guard
- Zawsze `safeFetch` z `api/_lib/safe-fetch.ts` (http/https, blokada adresów prywatnych IPv4/IPv6, przypięty lookup, walidacja redirectów, limit rozmiaru)
- `redirect_uri` OAuth tylko przez `parseRedirectUri` (`api/_lib/oauth.ts`)

### #26 Nagłówki i formularze publiczne
- `vercel.json`: pełny CSP + `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy: same-origin`; nowe źródła zewnętrzne dopisuj do CSP
- Publiczne endpointy: honeypot + Cloudflare Turnstile (fail-closed) + rate limit + walidacja długości wszystkich pól
- Domena instancji tylko z konfiguracji (sekrety `ALLOWED_ORIGINS` / `AUTH_REDIRECT_URL`, `OAUTH_ISSUER` albo host żądania) - bez domyślnej domeny w kodzie
- Jeden origin portalu: alias `*.vercel.app` instancji przekieruj (308) na domenę kanoniczną w Vercel → Domains albo wpisem `redirects` z `has: host` w `vercel.json`, poza `/api/cron/*` (Vercel Cron woła adres produkcyjny `*.vercel.app` i nie podąża za przekierowaniem); repozytorium nie zawiera wpisu żadnej instancji.
- `.claude/settings.local.json` nieśledzone (w `.gitignore`)

### #27 Dezaktywacja = kill switch (migracja `20261107200000_security_kill_switch.sql`)
- `profiles.is_active=false` → trigger `profiles_access_on_is_active_change` woła `revoke_user_access(user, reason, ban=true)`: kasuje sesje i refresh tokeny, unieważnia `mcp_tokens`/`oauth_clients`/niewykorzystane `oauth_codes`, banuje konto (`banned_until = now() + 100 lat`; NIE `'infinity'` - GoTrue zwraca wtedy 500). Reaktywacja zdejmuje bana, stare tokeny zostają unieważnione.
- "Wyloguj wszędzie" i reset 2FA (Edge) dodatkowo losują hasło (`_shared/credentials.ts`), ustawiają `password_set=false` i wysyłają link odzyskiwania.
- `is_aal2()` wymaga, by `session_id` z JWT istniał w `auth.sessions` - odwołana sesja traci dostęp do RLS/Storage/Realtime od razu. Ręcznie mintowane JWT do smoke testów muszą mieć `session_id` istniejącej sesji.
- Polityki "własnych wierszy" (PoliAI, tokeny MCP/OAuth, `profiles_update_self`, avatary) mają `is_authenticated_active()`; PIN trybu prywatnego wymaga aal2.

### #28 Strażnik ról
- Trigger `profiles_guard_role_active` (BEFORE INSERT / UPDATE OF role, is_active / DELETE): nikt nie zmienia własnej roli ani aktywności (42501); rolę `posel` nadaje/odbiera i konto Posła (de)aktywuje/usuwa tylko Poseł - administrator dostaje 42501 (ścieżka service_role: ta sama reguła w Edge Functions, `isCallerPoselRole`); ostatni prawdziwy Poseł (aktywny, `password_set`, zweryfikowany TOTP; `service_other_real_posel_exists`) nie może być zdegradowany, zdezaktywowany ani usunięty (23514) - na każdej ścieżce. Przekazanie władzy: najpierw powołaj drugiego Posła i poczekaj, aż ustawi hasło i 2FA.
- Posel i administrator mają równe uprawnienia w biurze (2026-11-07), z wyjątkiem zarządzania kontami Posłów (tylko Poseł, 2026-11-10).

### #29 Anon i kanały zewnętrzne
- anon ma SELECT wyłącznie na `offices`, `powiaty`, `gminy`, `case_categories` + 3-4 publiczne RPC `get_public_*`; default privileges roli postgres nie dają anon praw do nowych tabel/sekwencji. Nowa tabela publiczna = jawny `grant select ... to anon` + polityka.
- Narzędzia zmieniające konta i ustawienia (`users_update`, `settings_update`) są tylko w kanale PoliAI (z akceptacją), nie w zewnętrznym `/api/mcp`. Tokeny MCP domyślnie wygasają po 90 dniach.
- PoliAI nie renderuje obrazów z markdownu i przepuszcza tylko linki https/http/mailto/tel/względne (ochrona przed eksfiltracją przez prompt injection z publicznych zgłoszeń). Link poza panel pokazuje host; bez potwierdzenia pełnego adresu otwiera się tylko własny origin i `https` na `gov.pl` bez query/fragmentu (`src/components/poliai/linkSafety.ts`). Karta zatwierdzenia pokazuje pełne wartości operacji (bez ucinania).
- Zmiana roli, `scope_*` albo dezaktywacja usuwa rozmowy i załączniki PoliAI użytkownika (trigger `profiles_purge_poliai_on_access_change`) - historia nie przechowuje danych spoza aktualnego zakresu.
- `/n/<slug>` serwuje tylko wysłane wydania, z CSP `sandbox`.

### #30 Hasła i Auth (prod)
- `password_min_length=12` + wymagane małe/duże litery, cyfry i znaki specjalne (Management API i `config.toml`); `disable_signup=true`. HIBP i `sessions_timebox` wymagają planu Pro - niewłączone.

---

## Appendix: OWASP Top 10 Coverage

| # | Kategoria | Pokrycie |
|---|-----------|----------|
| A01 | Broken Access Control | RLS z aal2, data_scope, jawny aal2 w Edge Functions / Vercel, auth checks |
| A02 | Cryptographic Failures | Supabase handles encryption, HTTPS |
| A03 | Injection | Supabase client (parameterized), Zod validation |
| A04 | Insecure Design | Jedna instancja na posła, RLS-first, operacje przez RPC |
| A05 | Security Misconfiguration | Edge Function auth, env vars |
| A06 | Vulnerable Components | pnpm audit, regular updates (`xlsx` z CDN SheetJS, nie z npm) |
| A07 | Auth Failures | Supabase Auth, token refresh |
| A08 | Data Integrity | Zod validation, RLS, CASCADE |
| A09 | Logging Failures | `audit_log` (triggery, RPC SECURITY DEFINER), logi bez PII |
| A10 | SSRF | `safeFetch` (`api/_lib/safe-fetch.ts`) dla pobierania ICS z URL-i użytkownika |

---

_Ostatnia aktualizacja: 2026-11-15_

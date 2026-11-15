# API (Edge Functions + Hooks)

## Supabase Edge Functions

**Wspólne (`supabase/functions/_shared/auth.ts`):** funkcje działają na service_role, więc RLS (`is_aal2()` w politykach) ich nie chroni. Funkcje admina, `ai-proxy` i `getresponse-proxy` po sprawdzeniu roli wymagają jawnie sesji aal2 (`isCallerAal2` → RPC `is_aal2`, błąd = odmowa, fail-closed; 403 "Wymagane uwierzytelnienie dwuskładnikowe (2FA)"), walidują `user_id` regexem `UUID_RE` i audytują przez `serviceAudit` → RPC `service_log_audit` (aktor = wywołujący; `log_audit` nie jest wykonywalne przez authenticated).

**Konto Posła (od migracji `20261110150000_edge_auth_hardening`):** konto z rolą `posel` tworzy, usuwa, (de)aktywuje, degraduje, resetuje mu 2FA, wylogowuje i wysyła mu link tylko inny **Poseł** - Administrator dostaje 403 (`isCallerPoselRole` + `POSEL_ONLY_MESSAGE` w `_shared/auth.ts`; rola wywołującego z `profiles`, bo `is_posel()` obejmuje też administratora). Ścieżkę klienta (UPDATE/INSERT `profiles` z panelu) pilnuje trigger `profiles_guard_role_active` (BEFORE INSERT/UPDATE OF role, is_active/DELETE; 42501). Ochrona ostatniego Posła (23514) liczy tylko prawdziwe konta: aktywny `posel` z `password_set = true` i zweryfikowanym faktorem TOTP (`service_other_real_posel_exists(p_exclude)`, service_role) - nieprzyjęte zaproszenie Posła się nie liczy.

**Zależności (EDGE-8):** każda funkcja ma własny `deno.json` (mapa importów: `@supabase/supabase-js` → `npm:@supabase/supabase-js@2.45.4`, w `ai-proxy` też `zod` → `npm:zod@3.23.8`; `"lock": {"frozen": true}`) i `deno.lock` w wersji **4** (integralność także zależności pośrednich). CLI `supabase functions deploy` bierze `deno.json` z katalogu funkcji, a bundler edge-runtime (Deno 2.1.4) odrzuca paczkę o innej sumie niż w locku. Lock v5 (Deno ≥ 2.3) psuje deploy ("Unsupported lockfile version '5'") - lock regenerować tylko Deno 2.1.x: `cd supabase/functions/<fn> && deno cache --frozen=false --lock=deno.lock index.ts`. Nowa zależność = wpis w `deno.json` + regeneracja locka; bez importów `https://esm.sh/...`.

### public-submit-case
**Endpoint:** `POST /functions/v1/public-submit-case`
**Auth:** brak (publiczne, dostępne dla anonimowych)
**Body:**
```ts
{
  reporter_name: string,        // 3-100 znaków
  reporter_email?: string,      // email LUB phone wymagane
  reporter_phone?: string,
  powiat_id: number,
  gmina_id?: number | null,     // jeśli podane, musi należeć do powiatu
  category_id: number,          // tylko systemowe (case_categories.is_system=true)
  title: string,                // 5-200 znaków
  description: string,          // 20-5000 znaków
  rodo_consent: true,
  website?: string,             // honeypot, MUSI być puste
  turnstile_token: string       // token Cloudflare Turnstile (max 2048 znaków)
}
```
**Response (200):** `{ success: true, submission_id: string }`
**Errors:**
- 400 - błąd walidacji (z konkretnym `error: string`), FK nie istnieją, brak tokenu Turnstile
- 403 - nieudana weryfikacja Turnstile
- 405 - inna metoda niż POST
- 429 - rate limit (>3 zgłoszenia / adres / 1h; IPv6 liczone po prefiksie /64) albo limit globalny instancji (>60 zgłoszeń / 1h)
- 500 - błąd konfiguracji środowiska / DB

**Flow:**
1. Honeypot check (`website` puste; jeśli wypełnione → 200 OK bez insertu)
2. Walidacja po stronie serwera (typy i długości wszystkich pól, regex e-mail/telefon, contact required, user-agent obcięty do 512)
3. Cloudflare Turnstile: `siteverify` z sekretem `TURNSTILE_SECRET` + sprawdzenie `hostname` (sekret `TURNSTILE_ALLOWED_HOSTNAMES`, domyślnie hosty z `ALLOWED_ORIGINS` + `localhost`); brak sekretu = odmowa (fail-closed). `action` nie jest sprawdzane - widget go nie ustawia.
4. Hash adresu: SHA-256(`${bucket}:${PUBLIC_SUBMISSION_IP_SALT}`), `bucket` = pełny IPv4 (także IPv4-mapped `::ffff:a.b.c.d`) albo prefiks IPv6 `/64` (`rateLimitBucket`); ten hash trafia też do `cases.submission_ip_hash`
5. Rate limit: RPC `claim_public_submission_slot(ip_hash, 3, 3600)`, potem `claim_public_submission_slot('global', 60, 3600)` (stały klucz = limit instancji; odrzucenie per adres nie zużywa limitu globalnego) - atomowo (advisory lock per klucz, tabela `public_submission_attempts`)
6. Walidacja FK: powiat istnieje; gmina (jeśli) należy do powiatu; kategoria is_system
7. Insert do `cases` (`source='public_form'`) via service_role (RLS pomijane)

**Wymagane env (Supabase secrets):**
- `PUBLIC_SUBMISSION_IP_SALT` (256-bitowy hex, generowany losowo)
- `TURNSTILE_SECRET` (sekret Cloudflare Turnstile)
- `SUPABASE_SERVICE_ROLE_KEY` (już istnieje)

**Frontend:** widget `src/components/public/TurnstileWidget.tsx`, klucz witryny `TURNSTILE_KEY` (Vercel env). CSP w `vercel.json` dopuszcza `https://challenges.cloudflare.com`.

**CORS:** `corsHeadersFor(req)` (whitelist: produkcja + localhost)

### ai-proxy
**Endpoint:** `POST /functions/v1/ai-proxy`
**Auth:** Bearer (zalogowany writer: Poseł/Pracownik, sesja aal2). Brak ścieżki service_role (usunięta - nikt jej nie wołał, omijała aal2, limit i audyt).
**Klucz AI:** `anthropic_api_key` w Supabase Vault + `app_settings.ai_model`. Klucz niedostępny dla klientów (zapis RPC `set_secret_setting`, status `get_secret_settings_status`), Edge Function czyta go przez service_role RPC `service_get_secrets`. Klucz API instancji (Claude Console) wpisuje Poseł w ustawieniach integracji.
**Akcje (`{ action, payload? }`):**
- `status` (writer) → `{ configured, model }` - bez ruchu do Anthropic
- `check_connection` (Poseł) → `GET /v1/models`; `{ ok: true, model, model_available, models[] }` albo `{ ok: false, status, code, error }`
- `run_task` (writer) → `{ task, input }` → `{ text, model }`. Rejestr zadań jest obecnie pusty po przeniesieniu interpelacji do MCP.
**Errors:** 400 (zła akcja/zadanie/wejście), 401, 403, 409 `AI_NOT_CONFIGURED`, 502 z `code`: `AI_KEY_INVALID`, `AI_KEY_FORBIDDEN`, `AI_NO_CREDITS`, `AI_MODEL_NOT_FOUND`, `AI_RATE_LIMIT`, `AI_UPSTREAM`, `AI_EMPTY`; 500.
**Nowa funkcja AI:** wpis w `supabase/functions/ai-proxy/tasks.ts` i dedykowany, typowany hook w kliencie.

### admin-delete-user
**Endpoint:** `POST /functions/v1/admin-delete-user`
**Auth:** Bearer (użytkownik zalogowany jako Poseł, sesja aal2)
**Body:** `{ user_id: string }`
**Response (200):** `{ success: true }`
**Errors:**
- 401 - brak Authorization header / sesja niewazna
- 403 - wywołujący nie jest Posłem / brak aal2 / Administrator usuwa konto Posła
- 400 - brak user_id / proba usuniecia samego siebie / blad auth.admin.deleteUser
- 500 - błąd konfiguracji
- 409 - ostatni prawdziwy Poseł (inny aktywny Poseł z hasłem i 2FA nie istnieje)

**Flow:**
1. Sprawdza role wywołującego przez RPC `is_posel()`
2. Blokuje self-delete (`user_id === caller.id`)
3. Pobiera profil (email/full_name/role/office_id) do audit log; profil `posel` → wymaga roli `posel` u wywołującego
4. Aktywny `posel` → RPC `service_other_real_posel_exists(user_id)`; `false` → 409 (trigger to samo przy wyścigu)
5. `auth.admin.deleteUser(user_id)` z service_role → CASCADE usuwa profile
6. `serviceAudit('user.delete', 'profile', user_id, {...})`

**Skutki uboczne:**
- `profiles` usuwany przez CASCADE z `auth.users`
- FK w innych tabelach (`audit_log.user_id`, `cases.created_by/assigned_to`, `events.created_by/assigned_to`, `contacts.created_by`, `interpellations.created_by`, `visibility.updated_by`, `public_submissions.triaged_by`) sa ON DELETE SET NULL — historia zachowana, autor staje sie NULL
- Avatar w Storage `avatars/{user_id}/...` pozostaje jako orphan (akceptowalne w MVP)

**Wymagane env (Edge Function):** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### admin-reset-user-mfa
**Endpoint:** `POST /functions/v1/admin-reset-user-mfa`
**Auth:** Bearer (użytkownik zalogowany jako Poseł, sesja aal2)
**Body:** `{ user_id: string }`
**Response (200):** `{ success: true, deleted_count: number }`
**Errors:**
- 401 - brak Authorization / sesja niewazna
- 403 - wywołujący nie jest Posłem / brak aal2 / Administrator resetuje 2FA Posła
- 400 - brak user_id / proba self-reset (Posel nie moze tym kanalem zresetowac sobie 2FA — recovery przez drugiego Posla albo Supabase Dashboard)
- 500 - błąd konfiguracji / admin API

**Flow:**
1. RPC `is_posel()` (z tokenem usera) → 403 jesli nie
2. Blokada `user_id === caller.id` → 400
3. `admin.mfa.listFactors({ userId })` → lista factor-ow do usuniecia
4. Loop: `admin.mfa.deleteFactor({ userId, id })` dla kazdego factor (best-effort, log warn na blad)
5. `serviceAudit('mfa.admin_reset', 'profile', user_id, { target_email, factor_count, deleted_count })`

**Skutki uboczne:**
- User stracil wszystkie zarejestrowane TOTP factor-y
- Przy nastepnym wejsciu do portalu zobaczy `MfaEnrollmentScreen`
- Nie wpływa na sesje istniejące — RLS aal2 i tak je zablokuje przy następnym refreshu tokena (aktualne aal2 tokeny tracą "kotwicę" przy refresh, bo factor już nie istnieje)

**Wymagane env (Edge Function):** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### admin-send-auth-link
**Endpoint:** `POST /functions/v1/admin-send-auth-link`
**Auth:** Bearer (użytkownik zalogowany jako Poseł, sesja aal2)
**Body:** `{ user_id: string }`
**Response (200):** `{ success: true, kind: 'invite' | 'recovery' }`
**Errors:**
- 401 - brak Authorization / sesja niewazna
- 403 - wywołujący nie jest Posłem / brak aal2 / Administrator wysyła link do konta Posła
- 400 - brak/niepoprawny user_id / proba self-link / konto nieaktywne / błąd wysyłki maila
- 404 - nie znaleziono profilu
- 429 - cooldown 5 min od ostatniej wysyłki (response zawiera `retry_after_seconds`)
- 500 - błąd konfiguracji

**Flow:**
1. RPC `is_posel()` → 403 jesli nie; `isCallerAal2` → 403 bez aal2
2. Blokada self-link (`user_id === caller.id`)
3. Pobiera profil (full_name/role/password_set/is_active); odrzuca nieaktywne; profil `posel` → wymaga roli `posel` u wywołującego
4. Adres docelowy = email konta Auth (`auth.admin.getUserById`), nie edytowalny `profiles.email`
5. Cooldown + audyt atomowo PRZED wysyłką: RPC `service_audit_claim_cooldown(caller, 'user.invite_resent' | 'user.password_reset_sent', 'profile', user_id, { target_email, target_full_name }, [obie akcje], 300)` - advisory lock per user, zwraca 0 (wpis zapisany) albo sekundy do końca cooldownu → 429 z `retry_after_seconds`; równoległe wywołania nie omijają limitu
6. Wybiera `kind` i faktycznie wysyła mail (`admin.generateLink` tylko generuje link, maila nie wysyła - dlatego nie jest używany):
   - `password_set=false` → `'invite'`: `auth.admin.inviteUserByEmail()` (GoTrue ponownie wysyła zaproszenie niepotwierdzonemu kontu); gdy konto już potwierdzone → `signInWithOtp` (magic link, `shouldCreateUser=false`; `PasswordSetupScreen` wymusi hasło)
   - `password_set=true` → `'recovery'`: `resetPasswordForEmail()` (mail z linkiem resetu hasła)
   - `redirectTo` = `AUTH_REDIRECT_URL` (wymagany - bez niego 500 z komunikatem o brakującej konfiguracji); `/recover` i `/otp` przez klienta anon z `flowType: 'implicit'`
7. Błąd wysyłki → dodatkowy wpis `user.auth_link_failed` ({ ..., kind, error }) i 400; cooldown zostaje

**Skutki uboczne:**
- Supabase wysyla email z linkiem (invite/magiclink/recovery) na adres uzytkownika
- Cooldown chroni przed spamem (rate limit po stronie audit_log)

**Wymagane env:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_REDIRECT_URL`

### admin-revoke-user-sessions
**Endpoint:** `POST /functions/v1/admin-revoke-user-sessions`
**Auth:** Bearer (użytkownik zalogowany jako Poseł, sesja aal2)
**Body:** `{ user_id: string }`
**Response (200):** `{ success: true, sessions_revoked_count: number, mfa_deleted_count: number }`
**Errors:**
- 401 - brak Authorization / sesja niewazna
- 403 - wywołujący nie jest Posłem / brak aal2 / Administrator wylogowuje konto Posła
- 400 - brak/niepoprawny user_id / proba self-revoke
- 500 - błąd konfiguracji / unieważniania sesji

**Flow:**
1. RPC `is_posel()` → 403 jesli nie; `isCallerAal2` → 403 bez aal2
2. Blokada self-revoke
3. RPC `admin_revoke_user_sessions(user_id)` (service_role) — usuwa wszystkie `auth.sessions` usera (refresh tokeny kaskadowo) + stare refresh tokeny bez `session_id`. `auth.admin.signOut` wymaga JWT usera, nie UUID, więc nie nadaje się do wylogowania innego użytkownika.
4. `admin.mfa.listFactors({ userId })` + loop `admin.mfa.deleteFactor(...)` — usuwa wszystkie factory (best-effort)
5. `serviceAudit('user.sessions_revoked', 'profile', user_id, { target_email, target_full_name, sessions_revoked_count, mfa_deleted_count })`

**Skutki uboczne:**
- User wylogowany ze wszystkich urzadzen, refresh tokeny niewazne
- Wszystkie MFA factory usuniete — przy nastepnym logowaniu pelny flow (haslo + MfaEnrollmentScreen)
- Operacja "kill switch" dla scenariuszy: kompromitacja konta, zwolnienie pracownika, zgubiony laptop

**Wymagane env:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### admin-create-user
**Endpoint:** `POST /functions/v1/admin-create-user`
**Auth:** Bearer (użytkownik zalogowany jako Poseł, sesja aal2)
**Body:** `{ email: string, full_name: string, role: 'posel'|'administrator'|'pracownik'|'asystent', office_id?: string|null, scope_contacts?, scope_cases?, scope_events?, scope_interpellations?: 'own'|'all' }`
- `office_id` **wymagane** dla Pracownika i Asystenta. Dla Posła/Administratora opcjonalne (NULL OK).
- `scope_*` opcjonalne (brak = default kolumny `all`). Zapisywane tylko dla Pracownika/Asystenta; dla Posła/Administratora pomijane.
**Response (200):** `{ success: true, user_id: string }`
**Errors:**
- 401 - brak Authorization header
- 403 - wywołujący nie jest Posłem / brak aal2 / Administrator tworzy konto z rolą `posel`
- 409 - konto z tym adresem już istnieje albo powstało w międzyczasie
- 400 - niepełne dane / nieprawidłowa rola / brak office_id dla rol != poseł / biuro nie istnieje lub nieaktywne / `scope_*` spoza `own|all`
- 500 - błąd konfiguracji lub bazy

**Flow:**
1. Sprawdza role wywołującego przez RPC `is_posel()` (z tokenem usera); rola `posel` w body → wymaga roli `posel` u wywołującego
2. Walidacja: rola != poseł wymaga office_id; sprawdź `offices.is_active = true`
3. Istniejący profil z adresem → 409; konto Auth bez profilu: nieużyte (niepotwierdzone, bez logowania) usuwa, użyte → 409
4. `auth.admin.createUser({ email, email_confirm: false })` - błąd 422 `email_exists`, gdy konto istnieje (np. powstało po kroku 3) → 409; nigdy nie nadajemy roli kontu, którego nie utworzyło to wywołanie (koniec marginesu `created_at`)
5. `auth.admin.inviteUserByEmail()` - GoTrue wysyła zaproszenie dla tego (niepotwierdzonego) konta; inne `user.id` albo błąd → rollback
6. Insert profile z rola + office_id + scope_*; błąd → rollback (usuń utworzone konto Auth)
7. `serviceAudit('user.create', 'profile', user_id, {role, email, office_id, scope_*})`

**Wymagane env (Edge Function):**
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_REDIRECT_URL` (wymagane, np. `https://biuro.example.pl/login`; bez niego 500)

## Vercel Serverless Functions

- `/api/mcp` - serwer MCP (opis: [features/mcp-integration.md](../features/mcp-integration.md)). Batch JSON-RPC max 10 elementów, body max 1 MB.
- `/api/oauth/authorize`, `/api/oauth/code`, `/api/oauth/token`, `/.well-known/oauth-authorization-server` (rewrite → `/api/oauth/discovery`) - serwer OAuth 2.0 dla claude.ai (opis w mcp-integration.md).
- `/api/integracje` - funkcja wielooperacyjna (`?op=`, limit 12 funkcji Vercel Hobby): `ics_sync` (Poseł, sesja aal2 - `isAal2Session` z `api/_lib/jwt.ts`; dawniej `/api/sync-ics`). `/api/cron/sync-ics` (`CRON_SECRET`, tylko źródła z `is_active = true`). Pobieranie ICS przez `api/_lib/safe-fetch.ts`.
- Crony: jedna funkcja `api/cron/[job].ts` (`CRON_SECRET`) dla `/api/cron/sync-ics` (`api/_lib/cron/syncIcs.ts`), `/api/cron/poliai-purge` (`api/_lib/cron/purge.ts`; także sieroty `signing-documents` i pliki anulowanych dokumentów po 30 dniach) i `/api/cron/notifications` (`api/_lib/cron/notifications.ts`) - limit 12 funkcji Vercel Hobby.
- `/api/notifications` - powiadomienia e-mail (Resend) i web push: `status`, `test`, `admin_status`, `admin_save` (sesja aal2), `dispatch` (token z `notification_server_config`, wołane przez pg_net). Opis: [features/powiadomienia.md](../features/powiadomienia.md).
- `api/_lib/jwt.ts` - `isAal2Session(jwt, userId)`: odczyt claimu `aal` (i zgodności `sub`) z JWT; wołać wyłącznie po `auth.getUser(jwt)`, który waliduje podpis.
- `api/_lib/safe-fetch.ts` - `safeFetch(url, opts)`: ochrona SSRF - tylko http/https, blokada adresów loopback/prywatnych/link-local/zastrzeżonych/metadanych chmury (IPv4, IPv6, IPv4 osadzone w IPv6), walidacja w `lookup` gniazda (połączenie przypięte do zwalidowanego adresu, brak DNS rebinding), ponowna walidacja każdego redirectu, limit czasu i rozmiaru (ICS: 5 MB).
- `/api/poliai` - PoliAI (strumień SSE) oraz operacje `?op=attachment` (przygotowanie załącznika) i `?op=budget-report` (raport AI budżetu za miesiąc: body `{month}`, odpowiedź `{report}`, kody `AI_NOT_CONFIGURED` 409, `BUDGET_REPORT_EMPTY` 422, `BUDGET_REPORT_LIMIT` 429, `BUDGET_REPORT_INVALID` 502; `api/_lib/poliai/budget-report.ts`).

## React Query - query keys

| Klucz | Hook | staleTime |
|-------|------|-----------|
| `['users']` | useUsers (admin, z join na office) | 60s |
| `['offices', { activeOnly }]` | useOffices | 60s |
| `['powiaty']` | usePowiaty | Infinity |
| `['gminy', powiatId\|'all']` | useGminy | Infinity |
| `['contacts', type, powiatId, gminaId, search]` | useContacts | 30s |
| `['contacts-stats', 'by-powiat']` | useContactsCountByPowiat | 30s |
| `['case-categories']` | useCaseCategories | 5min |
| `['cases', status, priority, categoryId, assignedTo, search]` | useCases | 30s |
| `['events', type, assignedTo, search, from, to]` | useEvents | 30s |
| `['app-setting', key]` | useAppSetting | 5min |
| `['secret-settings-status']` | useSecretSettingsStatus (Poseł, status kluczy API bez wartości) | 5min |
| `['powiat-visibility']` | usePowiatVisibility | 60s |
| `['interpellations']` | useInterpellations | 30s |
| `['interpellation', id]` | useInterpellation | 30s |
| `['public-offices']` | usePublicOffices (anon) | 5min |
| `['public-office-staff', officeId]` | usePublicOfficeStaff (anon) | 5min |
| `['mfa-factors', userId]` | useMfaFactors | 30s |
| `['user-admin-details', userId]` | useUserAdminDetails (Posel) | 30s |
| `['global-search', term]` | useGlobalSearch (palette Ctrl/Cmd+K, debounce 200 ms, min 2 znaki) | 30s |
| `['cases', 'detail', id]` | useCase (deep-link `?open=`) | domyślny |
| `['contacts', 'detail', id]` | useContact (deep-link `?open=`) | domyślny |
| `['events', 'detail', id]` | useEvent (deep-link `?open=`) | domyślny |
| `['expenses', 'detail', id]` | useExpense (deep-link `?open=`) | domyślny |
| `['budget-analytics', month]` | useBudgetAnalytics (RPC `get_budget_analytics`; unieważniany po zmianach wydatków) | domyślny |
| `['budget-reports', 'list', month]` | useBudgetReports (raporty AI miesiąca z autorem) | domyślny |

## Hooki

| Hook | Opis | Lokalizacja |
|------|------|-------------|
| `useAuth()` | session + profile + signIn / signOut. Wylogowanie i zmiana usera w karcie czyszczą cache react-query (`queryClient.clear()`) i "Ostatnie" wyszukiwarki (`clearRecent()`) | `src/contexts/AuthContext.tsx` |
| `useUsers()` | lista profili z join na office (Poseł only) | `src/hooks/useUsers.ts` |
| `useCreateUser()` | mutation: wywołanie Edge Function (z office_id) | `src/hooks/useUsers.ts` |
| `useUpdateUser()` | mutation: update role/is_active/office_id | `src/hooks/useUsers.ts` |
| `useDeleteUser()` | mutation: Edge Function admin-delete-user (trwale usuniecie konta) | `src/hooks/useUsers.ts` |
| `useSendAuthLink()` | mutation: Edge Function admin-send-auth-link (dyn invite/recovery, cooldown 5 min) | `src/hooks/useUsers.ts` |
| `useRevokeUserSessions()` | mutation: Edge Function admin-revoke-user-sessions (RPC `admin_revoke_user_sessions` + reset MFA) | `src/hooks/useUsers.ts` |
| `useUserAdminDetails(userId)` | query: RPC `get_user_admin_details` (last_sign_in, MFA counts, sessions count) | `src/hooks/useUsers.ts` |
| `useOffices({activeOnly?})` | lista biur poselskich | `src/hooks/useOffices.ts` |
| `useCreateOffice()` | mutation: insert biura (Poseł only) | `src/hooks/useOffices.ts` |
| `useUpdateOffice()` | mutation: update biura (is_main, is_active, dane) | `src/hooks/useOffices.ts` |
| `usePowiaty()` | słownik powiatów | `src/hooks/usePowiaty.ts` |
| `useGminy(powiatId?)` | słownik gmin (opcjonalny filter) | `src/hooks/useGminy.ts` |
| `useContacts(filters)` | lista kontaktów z filtrowaniem | `src/hooks/useContacts.ts` |
| `useCreateContact()` | mutation insert | `src/hooks/useContacts.ts` |
| `useUpdateContact()` | mutation update | `src/hooks/useContacts.ts` |
| `useDeleteContact()` | mutation delete (Poseł) | `src/hooks/useContacts.ts` |
| `useContactsCountByPowiat()` | statystyki dla mapy | `src/hooks/useContacts.ts` |
| `useCaseCategories()` | lista kategorii | `src/hooks/useCaseCategories.ts` |
| `useCreateCaseCategory()` | mutation: tworzenie user-added | `src/hooks/useCaseCategories.ts` |
| `useCases(filters)` | lista spraw z filtrowaniem | `src/hooks/useCases.ts` |
| `useCreateCase()` | mutation insert | `src/hooks/useCases.ts` |
| `useUpdateCase()` | mutation update | `src/hooks/useCases.ts` |
| `useDeleteCase()` | mutation delete (Poseł) | `src/hooks/useCases.ts` |
| `useEvents(filters)` | lista wydarzen z filtrowaniem | `src/hooks/useEvents.ts` |
| `useCreateEvent()` | mutation insert | `src/hooks/useEvents.ts` |
| `useUpdateEvent()` | mutation update | `src/hooks/useEvents.ts` |
| `useDeleteEvent()` | mutation delete (Poseł) | `src/hooks/useEvents.ts` |
| `useAppSetting<T>(key, default)` | generyczny read settingsa | `src/hooks/useAppSetting.ts` |
| `useUpdateAppSetting()` | mutation upsert app_settings | `src/hooks/useAppSetting.ts` |
| `usePowiatVisibility()` | view: kontakty + wydarzenia + dni od per powiat | `src/hooks/usePowiatVisibility.ts` |
| `useInterpellations()` | lista interpelacji bez ciężkich pól treści | `src/hooks/useInterpellations.ts` |
| `useInterpellation(id)` | pełna interpelacja z HTML, tekstem i relacjami | `src/hooks/useInterpellations.ts` |
| `useDecideInterpellation()` | decyzja Posła: akceptacja, uwagi albo odrzucenie | `src/hooks/useInterpellations.ts` |
| `useMarkInterpellationSent()` | potwierdzenie wysłania zaakceptowanej interpelacji | `src/hooks/useInterpellations.ts` |
| `useDeleteInterpellation()` | mutation delete (Poseł/Administrator) | `src/hooks/useInterpellations.ts` |
| `useAiConnection(enabled?)` | weryfikacja klucza + lista modeli (Poseł/Administrator) | `src/hooks/useAi.ts` |
| `useAiSettings()` / `useUpdateAiSettings()` | model AI w `app_settings` (Poseł); klucz API zapisywany przez `saveSecretSetting('anthropic_api_key', …)` | `src/hooks/useAi.ts` |
| `useSecretSettingsStatus()` / `saveSecretSetting(key, value)` | status kluczy API (`get_secret_settings_status`: `configured` + końcówka) / zapis (`set_secret_setting`; pusty = usunięcie). Klucze nigdy nie trafiają do przeglądarki | `src/hooks/useSecretSettings.ts` |
| `useSetPrivacyPin()` / `useVerifyPrivacyPin()` / `useClearPrivacyPin()` | RPC PIN-u trybu prywatnego (zmiana i wyłączenie wymagają obecnego PIN-u; `PrivacyPinLockedError` przy blokadzie) | `src/hooks/usePrivacyPin.ts` |
| `useUpdateMyProfile()` | self-edit (full_name/phone/avatar_url/is_public) — RLS blokuje role/is_active | `src/hooks/useUsers.ts` |
| `useUploadAvatar()` | upload pliku do Storage `avatars`, zwraca publicUrl | `src/hooks/useUsers.ts` |
| `usePublicOffices()` | lista biur dla niezalogowanych (RLS `offices_select_anon`) | `src/hooks/useOffices.ts` |
| `usePublicOfficeStaff(officeId)` | RPC `get_public_office_staff` — pracownicy biura (anon) | `src/hooks/useOffices.ts` |
| `useGlobalSearch(term)` | wyszukiwarka globalna: 5 tabel równolegle (`Promise.allSettled`, `.limit(5)`, ilike na słowo), wynik `{type,id,title,subtitle}` | `src/hooks/useGlobalSearch.ts` |
| `useOpenParam()` | `[openId, clear]` dla deep-linku `?open=<id>` | `src/hooks/useOpenParam.ts` |
| `useCase(id)` / `useContact(id)` / `useEvent(id)` / `useExpense(id)` | pojedynczy rekord po id (te same kolumny co lista) | `src/hooks/use{Cases,Contacts,Events,Expenses}.ts` |
| `useBudgetAnalytics(month)` | analityka budżetu miesiąca (RPC `get_budget_analytics`) | `src/hooks/useBudgetAnalytics.ts` |
| `useBudgetReports(month)` / `useGenerateBudgetReport()` / `useDeleteBudgetReport()` | raporty AI budżetu: lista, generowanie (`POST /api/poliai?op=budget-report`, ponowienie po 401), usuwanie (Poseł/Administrator) | `src/hooks/useBudgetReports.ts` |

## Konwencje

- Query keys: tablica, scoped do entity: `['users']`, `['users', userId]`, `['cases', workspaceId]`
- staleTime: 60s domyślnie; mutacje invalidate konkretnych keys (NIGDY broad invalidate)
- Select: explicit kolumny (NIGDY `select('*')`)
- Errors: rzucane do React Query → `onError` w komponencie z `toast.error()`

## Deploy Edge Function

```bash
pnpm dlx supabase link --project-ref <ref>
pnpm dlx supabase functions deploy admin-create-user
pnpm dlx supabase functions deploy admin-delete-user
pnpm dlx supabase functions deploy ai-proxy
pnpm dlx supabase secrets set ALLOWED_ORIGINS=https://<domena instancji> AUTH_REDIRECT_URL=https://<domena instancji>/login
pnpm dlx supabase secrets set TURNSTILE_SECRET=<secret z Cloudflare Turnstile>
# ALLOWED_ORIGINS = origin instancji (CORS wszystkich funkcji z _shared/cors.ts)
```

Deploy z działającym Dockerem (domyślne bundlowanie lokalnym edge-runtime - zweryfikowane: czyta `deno.json` i `deno.lock` z katalogu funkcji, odrzuca niezgodną sumę). `--use-api` (bundlowanie po stronie Supabase) nie zostało sprawdzone pod kątem locka - nie używać.

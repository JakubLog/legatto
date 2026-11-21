# Database (Supabase Postgres)

## Tabele

### profiles
1:1 z `auth.users`. Tworzony tylko przez Edge Function `admin-create-user`.

| Kolumna | Typ | Notes |
|---------|-----|-------|
| id | uuid PK | FK → auth.users(id) ON DELETE CASCADE |
| email | text NOT NULL | |
| full_name | text NOT NULL | |
| role | app_role NOT NULL | enum: poseł / pracownik / asystent (default: asystent) |
| is_active | boolean NOT NULL | default true |
| office_id | uuid NULL | FK → offices(id) ON DELETE SET NULL. Wymagane dla rol != poseł (walidacja w Edge Function, nie CHECK constraint) |
| phone | text NULL | publiczny telefon kontaktowy (widoczny na stronie biura jeśli `is_public=true`) |
| avatar_url | text NULL | URL zdjęcia (Storage bucket `avatars`). NULL → renderujemy initialki |
| is_public | boolean NOT NULL | default true. Czy pracownik widoczny na publicznej liście pracowników biura |
| password_set | boolean NOT NULL | default false. Po pierwszym `auth.updateUser({password})` ustawiane na true. ProtectedRoute renderuje PasswordSetupScreen gdy false |
| has_privacy_pin | boolean NOT NULL | default false. Czy user ma ustawiony PIN trybu prywatnego (sam hash w `profile_secrets`). Zmieniają go wyłącznie RPC PIN-u: trigger `profiles_guard_has_privacy_pin` przepuszcza zmianę tylko przy GUC `eposel.privacy_pin_rpc = 'on'` (ustawianym transakcyjnie w RPC), inaczej przywraca starą wartość - także dla `profiles_update_posel`. |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | trigger set_updated_at() |

**Indeksy:** `(role)`, `(is_active) where is_active = true`, `(office_id)`

**Triggery:** `profiles_guard_has_privacy_pin` (BEFORE INSERT/UPDATE), `profiles_validate_public_fields` (BEFORE INSERT/UPDATE OF full_name, phone, avatar_url; tylko przy zmianie wartości: `full_name` 2-120 znaków bez znaków sterujących, `phone` `^[0-9 +()./-]{5,25}$` lub NULL (pusty → NULL), `avatar_url` ustawiany przez `authenticated` musi zaczynać się od `<iss bez /auth/v1>/storage/v1/object/public/avatars/<id>/` - host instancji z podpisanego claimu `iss` JWT; service_role pomija sprawdzenie hosta, CHECK `profiles_avatar_url_storage_check` obowiązuje wszystkich), `profiles_audit` (AFTER INSERT/UPDATE/DELETE → `user.profile_create` / `user.profile_update` z diffem role/is_active/office_id/scope_*/is_public/full_name/email/phone/avatar_url / `user.profile_delete`; PIN nigdy nie trafia do audytu). Migracja `20261110160000_db_hardening.sql`.

### profile_secrets
Sekrety użytkownika (migracja `20261018210000_security_profiles_storage.sql`). RLS włączone **bez polityk**, brak grantów dla `anon`/`authenticated` - dostęp wyłącznie przez RPC SECURITY DEFINER (i service_role).

| Kolumna | Typ | Notes |
|---------|-----|-------|
| user_id | uuid PK | FK → profiles(id) ON DELETE CASCADE |
| privacy_pin_hash | text NULL | bcrypt (cost 10) PIN-u trybu prywatnego |
| pin_failed_attempts | integer NOT NULL | default 0. Licznik błędnych prób (zerowany po sukcesie i po nałożeniu blokady) |
| pin_locked_until | timestamptz NULL | blokada po 5 błędnych próbach (15 min) |

### trusted_devices
Zaufane przeglądarki do logowania PIN-em + 2FA z ekranu wyboru profilu (migracja `20261116100000_trusted_devices.sql`). RLS bez polityk, brak grantów dla `anon`/`authenticated`; odwołanie = DELETE.

| Kolumna | Typ | Notes |
|---------|-----|-------|
| id | uuid PK | |
| user_id | uuid NOT NULL | FK → profiles(id) ON DELETE CASCADE |
| public_key | jsonb NOT NULL | JWK `{kty: EC, crv: P-256, x, y}` (bez `d`); klucz prywatny tylko w przeglądarce, nieeksportowalny |
| label | text NOT NULL | np. „Chrome · macOS” (1-120 znaków) |
| created_at / expires_at | timestamptz | `expires_at` = rejestracja + 30 dni |
| last_used_at | timestamptz NULL | ostatnie logowanie PIN-em |
| challenge / challenge_expires_at | text / timestamptz NULL | jednorazowe wyzwanie (64 hex, 60 s), zerowane przy każdej próbie |

RPC: `register_trusted_device(p_public_key, p_label, p_replaces)` → `{id, expires_at}` (aktywne + aal2; max 10 na konto, najstarsze wypadają; audit `trusted_device.register`), `list_my_trusted_devices()` (aktywne + aal2, bez klucza), `revoke_trusted_device(p_id)` → boolean (audit `trusted_device.revoke`); service_role: `service_trusted_device_challenge(p_device_id)`, `service_trusted_device_consume(p_device_id)`. `revoke_user_access` usuwa urządzenia (klucz wyniku `trusted_devices`). pg_cron `trusted-devices-retention` kasuje wygasłe.

### offices
Biura poselskie. Pracownicy i Asystenci są do nich przypisani; Poseł opcjonalnie.

| Kolumna | Typ | Notes |
|---------|-----|-------|
| id | uuid PK | default gen_random_uuid() |
| name | text NOT NULL | np. "Biuro główne" |
| city | text NOT NULL | np. "Kraków" |
| address | text | opcjonalnie |
| phone | text | opcjonalnie |
| email | text | opcjonalnie |
| is_main | boolean NOT NULL | default false. Tylko jedno biuro może być oznaczone jako główne (partial unique index) |
| is_active | boolean NOT NULL | default true. Nieaktywne biuro nie może być przypisane do nowego usera (walidacja w Edge Function) |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | trigger set_updated_at() |

**Indeksy:** `(is_active) where is_active = true`, `unique (is_main) where is_main = true`

**Triggery:** `offices_audit` (AFTER INSERT/UPDATE/DELETE → `office.create` / `office.update` z diffem / `office.delete`; zastępuje logowanie z klienta).

### audit_log
Slady działań. Insert tylko przez SECURITY DEFINER: `log_audit()` (wołane z triggerów i RPC; EXECUTE ma tylko właściciel i service_role), `log_client_event()` (frontend, allow-lista MFA), `service_log_audit()` / `mcp_log_audit()` (service_role).

| Kolumna | Typ | Notes |
|---------|-----|-------|
| id | uuid PK | default gen_random_uuid() |
| user_id | uuid | FK → profiles.id, ON DELETE SET NULL |
| user_email | text | snapshot dla zachowania po usunięciu profilu |
| action | text NOT NULL | np. `user.create`, `case.update` |
| entity_type | text | np. `profile`, `case` |
| entity_id | uuid | |
| metadata | jsonb | |
| created_at | timestamptz | default now() |

**Indeksy:** `(user_id)`, `(entity_type, entity_id)`, `(created_at desc)`

## Enum types

- `app_role`: `poseł` / `pracownik` / `asystent`

## Funkcje pomocnicze (SECURITY DEFINER)

Wszystkie z `set search_path = public` i pobierają role z profili (NIE z JWT) - co pozwala deaktywacja konta = natychmiastowa utrata dostępu (bez czekania na expire JWT).

- `current_role() → app_role` - rola aktualnego usera lub null
- `current_office_id() → uuid` - office_id aktualnego usera
- `is_posel() → boolean`
- `is_writer() → boolean` (poseł + pracownik)
- `is_authenticated_active() → boolean`
- `log_audit(action, entity_type, entity_id, metadata)` - wstawia audit_log z aktorem `auth.uid()`. **Nie** jest wykonywalne przez `authenticated` (od `20261018200000`) - wołają je tylko triggery/RPC SECURITY DEFINER i service_role. Migracja sprawdza blokiem DO, że każda funkcja w `public` wołająca `log_audit()` jest SECURITY DEFINER.
- `log_client_event(p_action, p_entity_type?, p_entity_id?, p_metadata?) → void` - wąski wrapper dla frontendu (authenticated, aktywny profil). Allow-lista akcji: `mfa.enroll`, `mfa.verify_failed`, `mfa.unenroll`; encja zawsze = profil wywołującego, z metadata przechodzi tylko `factor_id`.
- `service_log_audit(p_user_id, p_action, p_entity_type?, p_entity_id?, p_metadata?) → void` - **service_role only**. Wpis z jawnym aktorem z Edge Functions (`_shared/auth.ts` → `serviceAudit`) i Vercel OAuth (`oauth.code_issued`, `oauth.token_issued`); bez flagi `via_mcp`. Aktor bez profilu → `metadata.actor_user_id`.
- `mark_my_password_set() → void` - ustawia `password_set=true` dla `auth.uid()` (bo polityka `profiles_update_self` tej kolumny nie pozwala zmienic)
- `set_my_privacy_pin(p_pin text, p_current_pin text default null) → void` - hashuje PIN bcrypt (cost 10) do `profile_secrets`, ustawia `profiles.has_privacy_pin=true`. Walidacja: regex `^[0-9]{4,8}$` (`privacy_pin_format`). Zmiana istniejącego PIN-u wymaga `p_current_pin` (`privacy_pin_current_required`); błędny obecny PIN liczy się jako nieudana próba i kończy funkcję bez zmian (bez wyjątku, żeby nie wycofać licznika). Audit `privacy_pin.set`.
- `verify_my_privacy_pin(p_pin text) → boolean` - server-side compare (bcrypt) przez helper `privacy_pin_attempt` (licznik prób). Zwraca false gdy PIN nieustawiony lub błędny; 5 błędów → blokada 15 min (`privacy_pin_locked`, errcode 42501). Audit `privacy_pin.verify_failed` / `privacy_pin.locked`.
- `clear_my_privacy_pin(p_current_pin text) → void` - wymaga obecnego PIN-u (`privacy_pin_not_set`, `privacy_pin_current_required`, `privacy_pin_locked`), zeruje hash i `has_privacy_pin`. Audit `privacy_pin.clear`.
- `is_aal2() → boolean` - JWT `aal=aal2` + żywy wiersz `auth.sessions` (`id = session_id` z JWT, ten sam użytkownik, `not_after`, sesja młodsza niż 30 dni i odświeżona w ostatnich 7 dniach - `auth_session_within_limits`) + zweryfikowany `auth.mfa_factors`. SECURITY DEFINER. Używane w politykach wrażliwych tabel i w RPC.
- `get_user_admin_details(p_user_id uuid)` - **Posel-only + aal2**. Zwraca metadane konta z `auth` schema dla panelu admin: `last_sign_in_at`, `email_confirmed_at`, `auth_created_at`, `sessions_count` (live, `not_after IS NULL OR > now()`), `mfa_factors_total`, `mfa_factors_verified`. SECURITY DEFINER + `set row_security off` (siegamy do `auth.users`/`auth.sessions`/`auth.mfa_factors`). Sprawdzenie roli i aal2 wewnatrz; inaczej `raise 42501`.
- `get_all_users_admin()` - Posel + aal2. `get_assignable_users()` - aktywny user + aal2; wszyscy aktywni ze wszystkich biur, z `office_id`/`office_name`/`office_city` (migracja `20261102100000_case_reassign_offices.sql`). `get_office_colleagues(p_office_id)` - aktywny user + aal2 (brak aktywnego profilu = odmowa).
- `set_secret_setting(p_key, p_value) → void` - Posel + aal2. Zapis `anthropic_api_key` / `getresponse_api_key` / `resend_api_key` (max 1000 znaków) do Supabase Vault (sekret `app_settings:<klucz>`); NULL / pusty string usuwa sekret. Audyt `setting.create|update|delete` bez wartości (`redacted: true`).
- `get_secret_settings_status() → table(key, configured, hint)` - Posel + aal2. Z `vault.decrypted_secrets`, bez wartości - tylko `configured` i końcówka `••••abcd`.
- `service_get_secrets(p_keys text[]) → table(key, value)` - **service_role only**. Odszyfrowane wartości z Vault dla allow-listy (`anthropic_api_key`, `getresponse_api_key`, `resend_api_key`, `vapid_private_key`); nieustawiony albo nieznany klucz = brak wiersza. Jedyna droga odczytu sekretów dla `api/` i Edge Functions (migracja `20261110170000_secrets_vault.sql`).
- `service_store_vapid_keys(p_public_key, p_private_key) → table(public_key, private_key)` - **service_role only**. Zapis pary VAPID (publiczny w `notification_server_config`, prywatny w Vault `notifications:vapid_private_key`) tylko gdy instancja nie ma kompletnej pary; zwraca obowiązującą parę (blokada wiersza - pierwszy zapis wygrywa).
- `admin_revoke_user_sessions(p_user_id) → integer` - **service_role only** (Edge Function `admin-revoke-user-sessions`). Usuwa wszystkie `auth.sessions` usera (refresh tokeny kaskadowo) + stare refresh tokeny bez `session_id`; zwraca liczbę sesji.
- `claim_public_submission_slot(p_ip_hash, p_max, p_window_seconds) → boolean` - **service_role only**. Atomowy limit publicznego formularza (advisory lock per `ip_hash`, tabela `public_submission_attempts`, sprzątanie wpisów > 1 dzień).
- `oauth_consume_code(p_code, p_client_id) → setof oauth_codes` - **service_role only**. Atomowe, jednorazowe zużycie kodu autoryzacyjnego (UPDATE `used_at` z warunkiem nieużyty + nie wygasły); pusty wynik = `invalid_grant`.

**Granty:** authenticated; revoked od anon/PUBLIC (po migracji `20260504010000_revoke_anon_explicit`). Wyjątki publiczne: `get_public_office_staff`, `get_public_upcoming_events` — anon ma execute. Trzy `*_my_privacy_pin` revoked od anon, granted authenticated. `log_audit`, `service_log_audit`, `admin_revoke_user_sessions`, `claim_public_submission_slot`, `oauth_consume_code`, `mcp_consume_token`, `service_get_secrets`, `service_store_vapid_keys` - tylko service_role.

## RLS - strategia

**RLS WŁĄCZONE na wszystkich tabelach.**

### profiles
- SELECT (`profiles_select_self_or_team`): `id = auth.uid()` (własny wiersz zawsze - AuthContext ładuje profil przed `MfaChallengeScreen` w aal1) **LUB** `is_authenticated_active() AND is_aal2()`. Listy dostarczają też SECURITY DEFINER RPC `get_all_users_admin()` (Poseł + aal2), `get_assignable_users()` i `get_office_colleagues(office_id)` (aktywni + aal2)
- INSERT: `is_posel()` (preferowany flow przez Edge Function z service_role)
- UPDATE-self (`profiles_update_self`): `id = auth.uid() AND is_aal2()` + WITH CHECK blokuje zmianę: `email`, `role`, `is_active`, `office_id`, `password_set`, `has_privacy_pin`, `created_at`, `scope_*`. Można edytować: `full_name`, `phone`, `avatar_url`, `is_public`, `updated_at`. Flagę `password_set` ustawia dedykowany RPC `mark_my_password_set()`, `has_privacy_pin` - RPC PIN-u.
- UPDATE-admin (`profiles_update_posel`): `is_posel()` (zmienia wszystko poza id/created_at)
- DELETE: `is_posel()` (preferujemy `is_active=false` lub Edge Function `admin-delete-user` dla CASCADE)

### offices
- SELECT: `is_authenticated_active()` (każdy widzi liste biur)
- INSERT/UPDATE/DELETE: `is_posel()`

### audit_log
- SELECT: `is_posel()` (tylko admin czyta audit log)
- INSERT: brak public policy → wstawiają tylko funkcje SECURITY DEFINER (`log_audit()` z triggerów/RPC, `log_client_event()`, `service_log_audit()`, `mcp_log_audit()`)

## Migracje

```
supabase/migrations/
  20260425000000_init_profiles_audit.sql              ← Faza 1
  20260425100000_init_contacts_powiaty_gminy.sql      ← Faza 2 (kontakty + slowniki)
  20260425200000_init_cases.sql                       ← Faza 3 (sprawy + kategorie)
  20260426000000_init_offices.sql                     ← Faza 1.1 (biura + profiles.office_id)
  20260426100000_init_events.sql                      ← Faza 4 (kalendarz wydarzen)
  20260426200000_init_visibility.sql                  ← Faza 5 (app_settings + view powiat_visibility_stats)
  20260426300000_init_interpellations.sql             ← Faza 6 (interpelacje)
  20260426400000_profiles_password_set.sql            ← Faza 1.2 (password_set flag)
  20260427000000_offices_public_read.sql              ← Public homepage (RLS dla anon na offices)
  20260427100000_profiles_public_fields.sql           ← Public office staff (phone/avatar_url/is_public + RPC)
  20260427200000_avatars_bucket.sql                   ← Storage bucket avatars
  20260504000000_tighten_permissions.sql              ← Strict profiles_update_self + mark_my_password_set + search_path
  20260504010000_revoke_anon_explicit.sql             ← Explicit REVOKE EXECUTE FROM anon na helperach RLS i triggerach
  20260504200000_init_privacy_pin.sql                 ← Tryb prywatny (privacy_pin_hash + 3 RPC bcrypt)
  20260504210000_privacy_pin_digits_only.sql          ← Tighten set_my_privacy_pin do regex ^[0-9]{4,8}$ PENDING
  20260504220000_privacy_pin_extensions_schema.sql    ← Fix: extensions.crypt/gen_salt (pgcrypto w schemie extensions, nie public) PENDING
  20260504300000_rls_aal2_hardening.sql               ← Wymog aal2 (TOTP) na wrazliwych tabelach PENDING
  20260507100000_init_office_expenses.sql             ← Faza 8: Budżet biura (expense_categories + office_expenses + bucket receipts) PENDING
  ...
  20261018200000_security_audit_settings_oauth.sql    ← Audyt bezpieczeństwa: log_audit bez authenticated, log_client_event/service_log_audit, sekrety app_settings, mcp_tokens.expires_at, oauth_consume_code, public_submission_attempts, admin_revoke_user_sessions
  20261018210000_security_profiles_storage.sql        ← Audyt bezpieczeństwa: profile_secrets + has_privacy_pin + PIN RPC z blokadą, profiles SELECT, triggery audytu, case_attachments/storage wg widoczności sprawy, aal2 w RPC admina i avatars_*_posel, set_created_by
  20261026100000_poliai_attachments.sql              ← PoliAI: bucket poliai-attachments, tabela poliai_attachments, purge niewysłanych, poliai_orphan_attachment_objects
  20261026200000_budget_analytics_reports.sql         ← Budżet: RPC get_budget_analytics / service_budget_analytics (rdzeń budget_analytics_core), tabela budget_reports (raporty AI)
  20261026220000_expenses_missing_invoice_file.sql    ← Budżet: office_expenses.missing_invoice_file (generated: receipt_path is null) + indeks częściowy
  20261102100000_case_reassign_offices.sql            ← Sprawy: biuro w get_assignable_users, audyt case.reassign (APPLIED 2026-11-06)
  20261104100000_site_content.sql                     ← Konfiguracja instancji posła (ADR 026): neutralne wiersze app_settings site_identity + homepage, RPC get_public_site_content (anon), bucket site-assets (APPLIED 2026-11-06)
```

## Storage buckety

### avatars
Public read, 2 MB limit, JPG/PNG/WebP. Path: `{user_id}/{timestamp}.{ext}` — nowy plik per upload (cache buster, stare orphans akceptowane w MVP).

**RLS:**
- SELECT: public (anon i authenticated)
- INSERT/UPDATE/DELETE własnego folderu (`{auth.uid()}/...`): authenticated
- INSERT/UPDATE/DELETE dowolnego (`avatars_*_posel`): `is_posel() AND is_aal2()` (admin upload za pracownika)

### poliai-attachments
Prywatny, 5 MB/obiekt, WebP/JPEG/PNG. Path: `{user_id}/{attachment_id}/p{NNN}.{webp|jpg|png}` — skompresowane obrazy stron załącznika PoliAI (wiersz w `poliai_attachments`: nazwa, rodzaj, tekst stron ze źródłem pdf/ocr/file).

**RLS:** INSERT/SELECT/DELETE tylko własnego folderu (`{auth.uid()}/...`) + `is_writer()` + `is_aal2()`. Tabela: SELECT własnych (aal2), zapis tylko service_role (`/api/poliai?op=attachment`). Retencja jak rozmowa (cascade), niewysłane po 1 dniu (`purge_expired_poliai_conversations`), pliki bez wiersza usuwa cron `poliai-purge`. Zmiana roli, `scope_*` albo dezaktywacja użytkownika usuwa od razu wszystkie jego wiersze `poliai_conversations` i `poliai_attachments` (trigger `profiles_purge_poliai_on_access_change`, migracja `20261110130000_poliai_scope_change_purge.sql`, audyt `poliai.history_purged`).

### site-assets
Public URL (`/storage/v1/object/public/site-assets/...`), 5 MB, JPG/PNG/WebP. Path: `homepage/{timestamp}.{ext}` — zdjęcia strony publicznej (np. zdjęcie posła w hero), nowy plik per upload (cache buster). Migracja `20261104100000_site_content.sql`.

**RLS:** SELECT/INSERT/UPDATE/DELETE (`site_assets_*_posel`): `is_posel() AND is_aal2()` (Poseł i administrator); INSERT i UPDATE dodatkowo tylko w folderze `homepage/` (`(storage.foldername(name))[1] = 'homepage'`). Brak polityki SELECT dla anon - plik dostępny po URL, bez listowania bucketu (jak `avatars` / `newsletter-assets`).

## Funkcje RPC (anon dostęp)

### get_public_office_staff(p_office_id uuid)
SECURITY DEFINER funkcja zwracająca tylko publiczne pola pracownika (id, full_name, role, phone, avatar_url) — **nie ujawnia email**. Filtruje: aktywne biuro + aktywny pracownik + `is_public=true`. Sortowanie: poseł → pracownik → asystent, alfabetycznie. `grant execute to anon, authenticated`.

### get_public_site_content()
SECURITY DEFINER, `stable`, `search_path = public`. Zwraca `jsonb {identity, homepage}` z `app_settings` (`site_identity`, `homepage`; brakujący klucz = `{}`) - żadne inne klucze nie wyciekają, tabela `app_settings` pozostaje niewidoczna dla anon. Frontend: `useSiteContent()` + `parseSiteContent` (zod, wartości domyślne per pole, listy per element). `revoke from public`, `grant execute to anon, authenticated`.

### app_settings - konfiguracja instancji posła (ADR 026)
Jedna instancja = jeden poseł. Klucze `site_identity` (tożsamość posła) i `homepage` (treść `/` i PublicLayout: seo, promo, external_links, hero, sections, offices, calendar, submit, footer); kształt = `siteIdentitySchema` / `homepageSchema` w `src/lib/siteContent.ts`. Seed migracji jest neutralny (`{}`, `on conflict do nothing`) - migracje są wspólne dla instancji; dane posła wpisuje panel admina. Zapis: UPDATE przez istniejącą politykę `app_settings_update_posel` (`is_posel() and is_aal2()`, `is_posel()` obejmuje administratora), audyt `setting.update` z `old_value` / `new_value` (trigger `app_settings_audit`). Wiersze istnieją od seedu, więc frontend robi tylko UPDATE (0 zwróconych wierszy = brak uprawnień).

Stałe newslettera (`footer_office_name`, `footer_contact_email`, `footer_privacy_url`) i `getresponse_from_name` na świeżej instancji są puste (seed `""`); wypełnia je Poseł w panelu.

## Faza 2 - tabele

### powiaty
12 jednostek okręgu 35. Słownik (read-only dla wszystkich aktywnych userow).

| Kolumna | Typ | Notes |
|---------|-----|-------|
| id | smallint PK | 1-12 |
| name | text UNIQUE | np. "olsztyński" |
| is_city | boolean | true tylko dla m. Olsztyn |
| lat | numeric(8,5) | dla mapy |
| lng | numeric(8,5) | dla mapy |

### gminy
61 wpisów. FK do powiat_id.

| Kolumna | Typ | Notes |
|---------|-----|-------|
| id | int PK identity | |
| powiat_id | smallint FK | references powiaty(id) |
| name | text | unique per powiat |
| type | text | check: 'miejska'/'wiejska'/'miejsko-wiejska' |

### contacts
Główna tabela kontaktów.

| Kolumna | Typ | Notes |
|---------|-----|-------|
| id | uuid PK | gen_random_uuid() |
| type | contact_type NOT NULL | enum |
| first_name, last_name | text NOT NULL | |
| function | text | wolny tekst (np. "wójt") |
| phone, email | text | oba opcjonalne |
| powiat_id | smallint NOT NULL FK | |
| gmina_id | int FK | nullable |
| miejscowość, street, postal_code | text | opcjonalne |
| notes | text | |
| tags | jsonb | default '[]' |
| created_by | uuid FK profiles | auto z auth.uid() przez trigger |
| created_at, updated_at | timestamptz | |

**Indeksy:** `(type)`, `(powiat_id)`, `(gmina_id)`, `(created_at desc)`, GIN `tsvector(first_name||last_name||function)`

**Triggery:**
- `set_updated_at` (BEFORE UPDATE)
- `set_created_by` (BEFORE INSERT: zawsze `auth.uid()` dla sesji usera; service_role zachowuje przekazaną wartość) + `contacts_keep_created_by` (BEFORE UPDATE OF created_by: niezmienne dla sesji usera)
- `validate_contact_gmina` (BEFORE INSERT/UPDATE - gmina musi należeć do powiatu)
- `contact_audit_trigger` (AFTER INSERT/UPDATE/DELETE → log_audit)

## RLS Faza 2

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|--------|--------|--------|--------|--------|
| powiaty | active user | - | - | - |
| gminy | active user | - | - | - |
| contacts | active user | writer | writer | poseł |

## Faza 3 - tabele

### case_categories
10 systemowych + dowolnie wiele user-added.

| Kolumna | Typ | Notes |
|---------|-----|-------|
| id | int PK identity | |
| name | text UNIQUE | |
| slug | text UNIQUE | auto-generowany ze slugify |
| color | text | nazwa koloru badge |
| is_system | boolean | systemowych nie da się modyfikować/usuwać |
| created_by | uuid FK profiles | null dla systemowych |
| created_at | timestamptz | |

### cases

| Kolumna | Typ | Notes |
|---------|-----|-------|
| id | uuid PK | |
| title | text NOT NULL | |
| description | text | |
| status | case_status NOT NULL | default 'nowa' |
| priority | case_priority NOT NULL | default 'normal' |
| category_id | int FK | null OK |
| contact_id | uuid FK contacts | null OK (alternatywa: reporter_*) |
| reporter_name, reporter_phone, reporter_email | text | ad-hoc gdy bez kontaktu |
| powiat_id | smallint FK | null OK |
| gmina_id | int FK | null OK; wymaga powiat_id |
| assigned_to | uuid FK profiles | przypisanie wewnątrz zespolu |
| due_date | date | |
| resolved_at | timestamptz | auto-fill przy załatwiona/odrzucona |
| resolution_notes | text | widoczne w UI gdy załatwiona/odrzucona |
| created_by | uuid FK profiles | auto z auth.uid() |
| created_at, updated_at | timestamptz | |

**Indeksy:** status, priority, category, contact, assigned, powiat, due_date (where not null), created_at desc, GIN tsvector(title||description)

**Triggery:**
- `set_updated_at`, `set_created_by`
- `cases_set_resolved_at` - toggle resolved_at zależnie od statusu
- `validate_case_gmina` - gmina ⊂ powiat (i wymaga powiat_id)
- `case_audit_trigger` - emit case.create/case.status_change/case.update/case.delete
- `cases_guard_provenance` (BEFORE INSERT/UPDATE, SECURITY INVOKER, `current_user in ('authenticated','anon')`) - klient wstawia tylko `source = 'internal'` bez `consent_*` = true i bez `submission_*`; w UPDATE `source`, `consent_*`, `submission_*` niezmienne (42501). Zapis zgłoszenia publicznego i zgód: tylko service_role (`public-submit-case`). Migracja `20261110160000_db_hardening.sql`.

## RLS Faza 3

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|--------|--------|--------|--------|--------|
| case_categories | active user + anon (only is_system=true) | writer (only is_system=false) | poseł (only is_system=false) | poseł (only is_system=false) |
| cases | active user | writer | writer | poseł |

### public_submissions (Faza 7)

Zgłoszenia z formularza publicznego na stronie głównej.

| Kolumna | Typ | Notes |
|---------|-----|-------|
| id | uuid PK | default gen_random_uuid() |
| reporter_name | text NOT NULL | 3-100 znaków (CHECK) |
| reporter_email | text NULL | walidacja regex w Edge Function |
| reporter_phone | text NULL | |
| powiat_id | smallint NOT NULL FK powiaty | |
| gmina_id | int NULL FK gminy | musi należeć do powiat_id (trigger) |
| category_id | int NOT NULL FK case_categories | tylko is_system w Edge Function |
| title | text NOT NULL | 5-200 znaków (CHECK) |
| description | text NOT NULL | 20-5000 znaków (CHECK) |
| rodo_consent | bool NOT NULL | CHECK = true |
| submission_ip_hash | text NOT NULL | SHA-256 z saltem (RODO - bez raw IP) |
| user_agent | text | |
| status | public_submission_status NOT NULL | default 'incoming' |
| triage_notes | text | |
| triaged_by | uuid FK profiles | auto-fill triggerem przy zmianie statusu |
| triaged_at | timestamptz | auto-fill triggerem |
| linked_case_id | uuid FK cases | gdy zgłoszenie skonwertowane na sprawę |
| submitted_at | timestamptz NOT NULL | default now() |

**Constraints:** `contact_required` (email LUB phone), `rodo_required` (true), długości name/title/description.

**Indeksy:** status, submitted_at desc, powiat, category, (ip_hash, submitted_at desc) - rate limit, GIN tsvector(title||description).

**Triggery:**
- `set_triaged_at` - auto-fill triaged_at + triaged_by przy przejściu z incoming; wyczyszczenie przy powrocie
- `validate_public_submission_gmina` - gmina ⊂ powiat
- `public_submission_audit_trigger` - eventy create/status_change/update/delete

**RLS:**

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|--------|--------|--------|--------|--------|
| public_submissions | active user | **brak policy** (tylko service_role przez Edge Function) | writer | poseł |
| powiaty | authenticated + **anon** | tylko admin | tylko admin | tylko admin |
| gminy | authenticated + **anon** | tylko admin | tylko admin | tylko admin |

## Enum types

- `contact_type`: wyborca / dziennikarz / samorządowiec / sołtys / inne
- `case_status`: nowa / w_toku / oczekuje / załatwiona / odrzucona
- `case_priority`: low / normal / high / urgent
- `public_submission_status`: incoming / triaged / linked_to_case / dismissed

## Faza 8 - Budżet biura

### expense_categories
Słownik kategorii wydatków (analogiczny wzór jak `case_categories`).

| Kolumna | Typ | Notes |
|---------|-----|-------|
| id | int PK identity | |
| name | text UNIQUE | |
| slug | text UNIQUE | |
| color | text | |
| is_system | boolean | systemowych nie da się edytować |
| created_by | uuid FK profiles | null dla systemowych |
| created_at | timestamptz | |

**Seed (9 systemowych):** Czynsz i media, Materiały biurowe, Sprzęt biurowy, Wynagrodzenia, Transport / Paliwo, Komunikacja, Catering / Reprezentacja, Druk / Materiały promocyjne, Inne.

### office_expenses
Główny rejestr wydatków biura.

| Kolumna | Typ | Notes |
|---------|-----|-------|
| id | uuid PK | |
| title | text NOT NULL | 2-200 znaków (CHECK) |
| description | text | |
| amount | numeric(12,2) NOT NULL | CHECK > 0 |
| category_id | int FK expense_categories | nullable |
| expense_date | date NOT NULL | |
| vendor | text | nazwa kontrahenta |
| invoice_number | text | nr faktury/rachunku |
| payment_method | text | enum-like: przelew/karta/gotowka/inne |
| receipt_path | text | path w bucketcie `receipts` (NIE URL) |
| receipt_mime | text | application/pdf, image/jpeg, ... |
| notes | text | |
| missing_invoice_file | boolean GENERATED ALWAYS (stored) | `receipt_path is null`; indeks częściowy `where missing_invoice_file`; zapis z klienta niemożliwy |
| created_by | uuid FK profiles | auto przez trigger |
| created_at, updated_at | timestamptz | |

**Indeksy:** `expense_date desc`, `category_id`, `created_at desc`, GIN tsvector(title || description || vendor || invoice_number).

**Triggery:** `set_updated_at`, `set_created_by`, `office_expenses_audit` (`expense.create / update / delete`).

### Storage bucket `receipts`

Prywatny (`public=false`), 5 MB limit, MIME: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`. Path: `{user_id}/{timestamp}-{slug}.{ext}`. `office_expenses.receipt_path` unikalny (indeks częściowy `office_expenses_receipt_path_key`); pliki starsze niż 7 dni bez wydatku (`receipts_orphan_objects`, service_role) usuwa cron `poliai-purge` (migracja `20261107910000_receipts_integrity.sql`).

**RLS:**
- SELECT: `is_authenticated_active() AND is_aal2()` (cały zespół widzi).
- INSERT/UPDATE/DELETE w własnym folderze: writer + aal2 + path[0]=auth.uid().
- Poseł: dowolny folder w bucketcie.

Frontend pobiera `createSignedUrl(path, 3600)` przy każdym podglądzie (1h ważność).

## RLS Faza 8

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|--------|--------|--------|--------|--------|
| expense_categories | active user + aal2 | writer + aal2 + non-system | poseł + aal2 + non-system | poseł + aal2 + non-system |
| office_expenses | active user + aal2 | writer + aal2 | writer + aal2 | poseł + aal2 |
| budget_reports | active user + aal2 | service_role | - | poseł + aal2 |

**Analityka:** `get_budget_analytics(p_month text) → jsonb` (authenticated, `is_authenticated_active()` + `is_aal2()`), `service_budget_analytics(p_month text)` (service_role); logika w `budget_analytics_core` (security definer, row_security off, bez grantów dla klientów). Kształt wyniku = `BudgetAnalytics` w `src/integrations/supabase/types.ts`.

### budget_reports
Raporty AI budżetu: `id uuid`, `period text` (YYYY-MM, CHECK), `content jsonb` (`BudgetReportContent`), `analytics jsonb` (migawka wejścia), `model text`, `created_by` FK profiles (set null), `created_at`. Indeks `(period, created_at desc)`. Zapis tylko `/api/poliai?op=budget-report` (service_role); trigger audytu `budget.report_delete`.

## Utwardzenie po audycie bezpieczeństwa (2026-10-18)

Migracje `20261018200000_security_audit_settings_oauth.sql` + `20261018210000_security_profiles_storage.sql`. Elementy profili, PIN-u i funkcji opisane wyżej; tu pozostałe obszary.

### app_settings - sekrety
- Od migracji `20261110170000_secrets_vault.sql` klucze `anthropic_api_key`, `getresponse_api_key`, `resend_api_key` są zaszyfrowane w Supabase Vault (`vault.secrets`, nazwy `app_settings:<klucz>`), a prywatny klucz VAPID jako `notifications:vapid_private_key` (kolumna `notification_server_config.vapid_private_key` usunięta). Migracja przeniosła istniejące wartości i usunęła je z `app_settings`; CHECK `app_settings_no_plaintext_secrets` blokuje te klucze w `app_settings` dla każdej roli (także service_role). Restrykcyjna polityka `app_settings_no_secret_keys` zostaje (Poseł + aal2 SELECT/INSERT/UPDATE pozostałych kluczy, writer + aal2 SELECT `newsletter_defaults`, brak DELETE).
- Zapis: RPC `set_secret_setting`, status bez wartości: `get_secret_settings_status` (FE: `src/hooks/useSecretSettings.ts`). Odczyt wartości tylko service_role przez `service_get_secrets` (PoliAI `api/_lib/poliai/session.ts` - pomijany, gdy operator ustawi `AI_API_KEY`; powiadomienia `api/_lib/notifications/settings.ts`, MCP `briefing.ts` i maska w `settings_list`, Edge Function `getresponse-proxy`). `authenticated`/`anon` nie mają dostępu do schematu `vault`.
- Vault szyfruje kluczem projektu Supabase (poza bazą): zrzut odtworzony w innym projekcie nie odszyfruje sekretów - klucze API wpisać ponownie w Integracjach, VAPID wygeneruje się od nowa (ponowna subskrypcja urządzeń push).
- Audyt zapisów sekretów robi `set_secret_setting` (`setting.*`, `redacted: true`, `configured`, `changed`); `app_settings_audit_trigger` nadal maskuje te klucze. Historyczne wpisy `setting.*` z kluczami w metadata wyczyszczone (2026-10-18). `notification_server_config.dispatch_token` zostaje jawny (czyta go trigger `pg_net` w bazie).

### mcp_tokens / OAuth
- `mcp_tokens.expires_at timestamptz` - tokeny OAuth dostają `now() + 30 dni` przy wydaniu (`/api/oauth/token`), tokeny ręczne z UI = NULL (bezterminowe). Istniejące aktywne tokeny OAuth bez terminu dostały 30 dni; indeks `mcp_tokens_oauth_client_idx`.
- `mcp_consume_token` odrzuca tokeny wygasłe i tokeny unieważnionej OAuth App (sygnatura bez zmian).
- `revoke_oauth_client(p_client_id)` (właściciel + aal2) unieważnia też wszystkie tokeny wydane przez aplikację (audit `oauth_client.revoke` z `tokens_revoked`; idempotentne).
- `oauth_consume_code` - atomowe zużycie kodu (opis w funkcjach wyżej).

### public_submission_attempts
Próby zgłoszeń z publicznego formularza (`id`, `ip_hash` hash IP z saltem, `created_at`). RLS bez polityk, brak grantów dla klienta - tylko `claim_public_submission_slot()`.

### case_attachments + bucket `case-attachments`
- Bucket wymuszony: prywatny, 10 MB, MIME PDF/JPG/PNG/WebP/DOC/DOCX/TXT.
- `ca_select`: active + aal2 + sprawa nadrzędna widoczna (EXISTS na `cases` pod RLS = respektuje `data_scope`).
- `ca_insert`: writer + aal2 + widoczna sprawa + pierwszy segment `storage_path` = `case_id`.
- Storage `case_attachments_upload`: writer + aal2 + pierwszy segment ścieżki = id widocznej sprawy. `case_attachments_read`: active + aal2 + istnieje widoczny wiersz `case_attachments` wskazujący obiekt (Poseł także bez wiersza - do `storage.remove`).
- Trigger `case_attachments_audit` (`case_attachment.create/update/delete`).

### ics_sources
Trigger `ics_sources_audit` (`ics_source.create/update/delete`; z URL logowany tylko host - `ics_url_host()`, synchronizacja nie jest logowana).

### created_by
`set_created_by()` na `contacts`, `cases`, `events`, `interpellations`, `office_expenses`, `case_attachments`, `ics_sources`, `case_categories`, `expense_categories`: INSERT zawsze `auth.uid()` dla sesji usera (service_role - MCP, Edge Functions, `sync_ics_events` - zachowuje przekazaną wartość); trigger `*_keep_created_by` (BEFORE UPDATE OF created_by) trzyma wartość niezmienną dla sesji usera (wyjątek: zagnieżdżone triggery, np. FK ON DELETE SET NULL).

### Utwardzenie 2026-11-10 (`20261110160000_db_hardening.sql`)
- `current_*_scope()` - brak lub nieaktywny profil = `'own'` (wcześniej `'all'`). Wszystkie polityki z tymi funkcjami i tak wymagają `is_authenticated_active()`, Poseł omija zakres `is_posel()`.
- Granty tabel `public`: `anon`/`authenticated` bez TRUNCATE, REFERENCES, TRIGGER (TRUNCATE omija RLS i triggery audytu); to samo w `alter default privileges for role postgres in schema public` dla nowych tabel. `audit_log` bez INSERT/UPDATE/DELETE dla `authenticated` (piszą tylko funkcje SECURITY DEFINER), `oauth_codes` bez grantów dla `authenticated`.
- Domyślne EXECUTE nowych funkcji bez zmian: PUBLIC/anon odebrane (`20261107800000`), `authenticated` zostaje - helpery RLS (`is_posel`, `is_aal2`, `current_*_scope`) i RPC klienta wykonują się jako `authenticated`. Funkcje tylko dla serwera: jawne `revoke all ... from public, anon, authenticated`.
- Funkcje SECURITY DEFINER w `public` mają `pg_temp` na końcu `search_path` (`public, pg_temp` / `public, auth, pg_temp`). Nowe funkcje SECURITY DEFINER: `set search_path = public, pg_temp` (`create or replace` bez tego zdejmuje `pg_temp`).
- Schemat `net` (pg_net): właścicielem schematu i funkcji `net.*` jest `supabase_admin`, który nadaje `anon`/`authenticated` USAGE i EXECUTE na `net.http_get`/`net.http_post` (event trigger `issue_pg_net_access`); rola `postgres` (migracje, SQL editor) nie może ich odebrać ("no privileges could be revoked"). Ochrona: `net` nie może być w "Exposed schemas" (API → `public`, `graphql_public`); funkcje wołające `net.*` (`notifications_dispatch_request`) są SECURITY DEFINER bez EXECUTE dla klienta.

### Utwardzenie 2026-11-13 (`20261113100000_security_pass4.sql`)
- **Jeden punkt odcięcia:** `revoke_user_access(p_user_id, p_reason, p_ban)` (service_role) usuwa refresh tokeny i sesje, unieważnia `mcp_tokens`/`oauth_clients`, usuwa niewykorzystane `oauth_codes`, `push_subscriptions` - na każdym poziomie; `p_ban=true` dodatkowo banuje (`now()+100 lat`). Wynik jsonb: `reason, sessions, refresh_tokens, mcp_tokens, oauth_clients, oauth_codes, push_subscriptions, banned`. Wołają go: dezaktywacja (`profiles_access_on_is_active_change`, ban), usunięcie profilu (`profiles_revoke_on_delete`, ban), `admin_revoke_user_sessions` ("Wyloguj wszędzie") i reset 2FA (Edge). Nowy kanał dostępu lub dostawy = nowa linia w tej funkcji, nie osobny trigger.
- **Limit życia sesji (plan Free):** `is_aal2()` = false dla sesji starszej niż 30 dni (`created_at`) albo bez odświeżenia dłużej niż 7 dni (`greatest(refreshed_at, updated_at)`); wartości w `auth_session_within_limits()`. `service_purge_stale_sessions() → {sessions, refresh_tokens}` (service_role) usuwa takie sesje i ich refresh tokeny, audyt `session.purged_stale` (`user_ids`); woła go codzienny cron aplikacji.
- **Dokumenty do podpisu:** autor (nie Poseł/Administrator) zmienia dokument w `signing_update_document` tylko w statusach `do_podpisu`/`do_poprawy`; w `pobrany`/`podpisany` → 42501 `Po podpisaniu dokument może zmienić tylko Poseł lub Administrator`. Audyt `signing.update` ma `status` i `changes` (`{from, to}`; `description`/`send_text` tylko długość i md5).
- **Komentarze do spraw:** `case_comments_prepare` - najwyżej 20 komentarzy autora w 10 minut (54000), indeks `(author_id, created_at)`.
- **Kosz:** `trash_restore` / `trash_restore_row` zwracają ten sam P0002 `Nie znaleziono pozycji w koszu` dla braku pozycji i braku uprawnień. `trash_restoring()` bez EXECUTE dla PUBLIC/anon (zostaje `authenticated`, `service_role`).
- `pg_temp` ponownie dopięte pętlą do wszystkich funkcji SECURITY DEFINER w `public` (52 funkcje z migracji 2026-11-10..12 go zgubiły). Reguła z sekcji wyżej obowiązuje: każda nowa lub przepisywana funkcja SECURITY DEFINER ma `set search_path = public, pg_temp` (albo `public, auth, pg_temp`).

### newsletter-assets
Publiczna polityka listowania obiektów usunięta (URL-e publiczne działają bez SELECT); SELECT dla authenticated tylko we własnym folderze writera lub Poseł, z aal2.

## Newsletter - wydania (2026-10-23)

### newsletter_issues
Migracja `20261023150000_newsletter_issues.sql` — **PENDING APPLY**. Wydanie newslettera: `template` (jsonb, treść edytora do duplikowania), `html_web` (wersja online, max 1 MB), `slug` (16 znaków base64url z `extensions.gen_random_bytes(12)`, unique), `status` `draft` → `sending` → `sent` (`sent_at` wymagane dokładnie przy `sent`; `sending` = rezerwacja wysyłki przez `getresponse-proxy`, powrót do `draft` po odrzuceniu przez GR, zostaje przy nieznanym wyniku), `gr_newsletter_id`, `created_by` (default `auth.uid()`). RLS: writer + aal2 SELECT; INSERT tylko `status = 'draft'` i `created_by = auth.uid()`; UPDATE tylko wierszy `draft` i tylko autor (`created_by = auth.uid()`) albo `can_manage_newsletters()` (`is_posel()` lub aktywny opiekun obszaru `newsletter` w `module_owners`; migracja `20261110140000_newsletter_issue_ownership.sql`); status/slug/sent_at/gr_newsletter_id zmienia tylko service_role (trigger `newsletter_issues_guard_publish`); brak DELETE. anon bez grantów — wersję online `/n/<slug>` serwuje `api/newsletter-view.ts` kluczem service_role (tylko `html_web` po slugu i wyłącznie `status = 'sent'`; szkic = 404, więc link z maila testowego działa dopiero po wysyłce). `html_web` pisze przeglądarka (niezaufany HTML), dlatego `/n/*` i `/api/newsletter-view` mają CSP `sandbox; default-src 'none'; ...` (funkcja + `vercel.json`; globalny CSP portalu wyłącza te ścieżki) - strona dostaje opaque origin, bez skryptów i dostępu do sesji portalu.

## Aplikowanie migracji (ręcznie, bez Supabase CLI)

1. Skopiuj zawartość pliku migracji
2. Wklej do Supabase Dashboard → SQL Editor → uruchom

LUB z CLI (jeśli zainstalowany):
```bash
pnpm dlx supabase link --project-ref <ref>
pnpm dlx supabase db push
```

## Seed pierwszego Posła

Po pierwszej migracji nie ma jeszcze żadnego Posła - chicken-and-egg z Edge Function. Seed ręcznie:

```sql
-- 1. W Auth → Users dodaj użytkownika z emailem
-- 2. Skopiuj jego UUID i odpal:
insert into public.profiles (id, email, full_name, role, is_active)
values ('<UUID_Z_AUTH>', '<EMAIL_POSLA>', '<IMIE_I_NAZWISKO>', 'posel', true);
```

Od tej pory ten user może tworzyć kolejne konta przez admin panel.

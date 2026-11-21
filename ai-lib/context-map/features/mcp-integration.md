# Feature: MCP integracja (Model Context Protocol)

> Pose ma mozliwosc podlaczenia portalu biura do Claude (Desktop / claude.ai) jako MCP server (`serverInfo.name` = `office-mcp`).
> Z poziomu rozmowy z Claude moze zarzadzac sprawami wyborcow, kontaktami,
> kalendarzem i interpelacjami biura.
> Tylko przy `INSTANCE_AI=on` w env operatora (ADR 028): przy `off` `/api/mcp`, `/api/oauth/*` i
> `/.well-known/oauth-authorization-server` zwracaja 404 `AI_DISABLED`, a strona Integracje → MCP i zgoda OAuth nie istnieja w SPA.
> Tokeny i aplikacje OAuth zostaja w bazie (RPC `create_mcp_token` / `create_oauth_client` bez bramki) i dzialaja od razu po wlaczeniu.

## Cel

Skrocenie petli "wpadl mi do glowy pomysl -> chce go zapisac w bazie biura" - bez
otwierania portalu. Pose w trakcie rozmowy z Claude prosi:

- "Pokaz mi 5 ostatnich spraw o statusie 'oczekuje'"
- "Stworz nowa sprawe: kategorie 'zdrowie', tytul: 'Brak SOR w Mragowie...'"
- "Co mam jutro w kalendarzu?"
- "Wgraj tę gotową interpelację HTML do akceptacji Posła"

Wszystko via Claude, dane lecz prosto do Supabase. Audit log ma flage `via_mcp=true`.

## Architektura

```
Claude Desktop / claude.ai
        |
        | HTTPS POST /api/mcp (JSON-RPC 2.0)
        | Authorization: Bearer epm_xxx...
        v
+-----------------------------+
|  Vercel serverless         |
|  api/mcp.ts                |
|  - parseBearer + sha256    |
|  - mcp_consume_token RPC   |
|  - tools dispatch          |
+-----------------------------+
        |
        | service_role JWT
        v
+-----------------------------+
|  Supabase                  |
|  - mcp_tokens (lookup)     |
|  - cases / contacts /      |
|    events / interpellations|
|  - audit_log (via_mcp)     |
+-----------------------------+
```

## Format tokena

```
epm_<48 znakow base64url>
```

Prefix `epm_` (historyczny skrot od dawnej nazwy serwera MCP). 36 bajtow entropii -> 48 znakow base64url.
W DB tylko sha256 (hex). Plaintext widoczny **tylko raz** w dialogu po wygenerowaniu.

`token_prefix` (12 znakow z plaintextu po `epm_`) jest pokazywany na liscie tokenow
zeby Pose mogl rozpoznac ktory to token bez ujawniania pelnej wartosci.

## DB

### Tabela `mcp_tokens`

| Kolumna | Typ | Opis |
|---------|-----|------|
| `id` | uuid PK | random |
| `user_id` | uuid FK profiles | wlasciciel (na razie zawsze Posel) |
| `name` | text | nazwa nadana przez usera (max 60) |
| `token_hash` | text UNIQUE | sha256 hex calego plaintextu |
| `token_prefix` | text | 12 znakow plain do listingu |
| `scopes` | text[] | array uprawnien (default: cases, contacts, events, interpellations) |
| `last_used_at` | timestamptz | bumpowany przez `mcp_consume_token` |
| `created_at` | timestamptz | |
| `revoked_at` | timestamptz | soft-delete; null = aktywny |
| `expires_at` | timestamptz NOT NULL | koniec ważności: tokeny OAuth 30 dni od wydania, tokeny ręczne 1-180 dni (domyślnie 90, wybór 30/90/180 w UI). NOT NULL od `20261110120000` |
| `oauth_client_id` | text FK oauth_clients | aplikacja OAuth, która wydała token (NULL = token ręczny) |

### RPC

| Funkcja | Caller | Opis |
|---------|--------|------|
| `create_mcp_token(p_name, p_days default 90)` | authenticated (Posel/Administrator/Pracownik + aal2) | Generuje plaintext + insert hash z `expires_at = now() + p_days` (1-180, inaczej 22023). Zwraca plaintext jednorazowo. Audit: `mcp_token.create` (z `expires_at`). |
| `revoke_mcp_token(p_token_id)` | authenticated (wlasciciel + aal2) | Soft-delete (revoked_at = now). Audit: `mcp_token.revoke`. |
| `delete_mcp_token(p_token_id)` | authenticated (wlasciciel + aal2) | Hard-delete - tylko juz unieważnionych tokenów (revoked_at must be set). Audit: `mcp_token.delete` (entity_id null, identyfikator w metadata). |
| `mcp_consume_token(p_token_hash)` | service_role only | Lookup po hash, odrzuca tokeny unieważnione, wygasłe (`expires_at`) i wydane przez unieważnioną OAuth App; bumpuje last_used_at, zwraca user_id + scopes + role. |
| `revoke_oauth_client(p_client_id)` | authenticated (wlasciciel + aal2) | Unieważnia OAuth App i wszystkie wydane przez nią tokeny. Audit: `oauth_client.revoke` (z `tokens_revoked`). |
| `oauth_consume_code(p_code, p_client_id)` | service_role only | Atomowe, jednorazowe zużycie kodu autoryzacyjnego (pusty wynik = `invalid_grant`). |
| `mcp_log_audit(p_user_id, p_action, ...)` | service_role only | Audit z explicit user_id (auth.uid() nie dziala z service_role JWT). Auto-dodaje `via_mcp=true` do metadata. |

### RLS

- SELECT: `user_id = auth.uid() AND is_aal2()` (Pose widzi tylko swoje, wymaga 2FA).
- INSERT/UPDATE/DELETE: brak policy = forbidden dla `authenticated`. Wszystko przez RPC SECURITY DEFINER.

## Vercel Serverless

### `/api/mcp.ts` (Node runtime)

JSON-RPC 2.0 nad HTTP POST. Bez SSE/Streamable HTTP w v1 - jeden POST = jeden response.

Obslugiwane metody MCP:
- `initialize` - protocolVersion + capabilities + serverInfo
- `notifications/initialized` - no-op
- `ping` - {}
- `tools/list` - rejestr tools
- `tools/call` - dispatch do konkretnego tool

GET na `/api/mcp` zwraca diagnostyczny opis serwera (przydatne do testowania).

### Pliki

- `api/mcp.ts` - main handler (CORS, auth, dispatch, batch max 10 elementów wykonywanych sekwencyjnie, body max 1 MB, bramka roli przy `tools/call`).
- `api/_lib/jsonrpc.ts` - typy + helpery rpcSuccess / rpcError.
- `api/_lib/supabase.ts` - cached service_role client.
- `api/_lib/auth.ts` - parseBearer + hashToken (sha256) + consumeToken. Kontekst: rola, email, biuro, `dataScopes` (z `profiles.scope_*`).
- `api/_lib/access.ts` - `applyDataScope(query, ctx, module)`: odpowiednik `current_*_scope()` z RLS.
- `api/_lib/audit.ts` - logAudit wrapping mcp_log_audit RPC.
- `api/_lib/tools/types.ts` - ToolDefinition (z opcjonalnym `roles`, `POSEL_ONLY`) + walidatory argow + ToolValidationError.
- `api/_lib/tools/index.ts` - rejestr ALL_TOOLS, `listTools(ctx)` filtrowane po roli, `isToolAllowed`.
- `api/_lib/tools/{me,dictionaries,cases,contacts,events,interpellations,budget,audit,users,offices,settings,ics}.ts` - moduly narzedzi.
- `api/tsconfig.json` - izolowany TS config dla katalogu `/api`.

### ENV (Vercel project settings)

| Zmienna | Opis |
|---------|------|
| `SUPABASE_URL` | Identyczny z VITE_SUPABASE_URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role JWT - nigdy w client bundle |
| `OAUTH_ISSUER` | Opcjonalne. Kanoniczny adres instancji; domyślnie z żądania (`api/_lib/issuer.ts`) |

### Adres instancji (bez domeny w kodzie)

- Frontend: `getMcpUrl()` (`src/lib/instanceUrls.ts`) = `${window.location.origin}/api/mcp` - używają go `Integracje.tsx`, `McpConfigInstructions.tsx`, `CreateOAuthClientDialog.tsx`.
- Serwer: `resolveIssuer(req)` (`api/_lib/issuer.ts`) - `OAUTH_ISSUER` (walidowany: https, http tylko localhost; zwracany `origin`), inaczej `x-forwarded-proto` + `x-forwarded-host`/`host` (walidacja składni hosta, poza localhost tylko https; błąd → `IssuerError`). Używany w discovery (`issuer`, endpointy, logo), authorize (redirect na `/oauth/consent`) i `serverInfo.logoUri` w `api/mcp.ts`.
- Bezpieczeństwo: issuer nie bierze udziału w walidacji tokenów (tokeny `epm_…` są nieprzezroczyste, sprawdzane hashem w bazie, bez `iss`/`aud`) ani `redirect_uri` (`parseRedirectUri` - stała lista claude.ai + loopback). Na Vercelu `x-forwarded-host` ustawia platforma, a żądanie dociera do deploymentu tylko przez domeny projektu, więc host z żądania = domena instancji.

### OAuth 2.0 (claude.ai)

Authorization Code + PKCE (S256) dla Remote MCP w claude.ai. Posel lub Pracownik (role MCP, `MCP_ROLES` w `api/_lib/auth.ts`) generuje własną OAuth App (`client_id` + `client_secret`, tabela `oauth_clients`) w `/biuro/admin/integracje/mcp`; Asystent odrzucany przy tworzeniu App, zgodzie (`/api/oauth/code`) i wymianie kodu. Token z `/api/oauth/token` dostaje `scopes` wg roli właściciela (jak `create_mcp_token`).

- `GET /.well-known/oauth-authorization-server` (rewrite → `api/oauth/discovery.ts`) - metadane RFC 8414.
- `GET /api/oauth/authorize` - walidacja klienta, `redirect_uri`, `code_challenge`; przekierowanie na stronę zgody `/oauth/consent` (SPA).
- `POST /api/oauth/code` - wołane ze strony zgody z Bearer sesji Supabase; wymaga **aal2** (`isAal2Session(jwt, user)`, `api/_lib/jwt.ts`: claim `aal2` i zweryfikowany czynnik w `user.factors` z `auth.getUser` - jak `is_aal2()` w bazie; usunięcie czynnika odbiera dostęp mimo starego JWT) i klienta należącego do Posła. Akcje w body: `describe` (nazwa klienta z bazy do ekranu zgody), `approve` (domyślnie; generuje kod, zwraca `redirect_url`), `deny` (`redirect_url` z `error=access_denied`). Frontend przekierowuje wyłącznie na zwrócony `redirect_url`. Audit `oauth.code_issued` (`service_log_audit`).
- `POST /api/oauth/token` - wymiana kodu: `oauth_consume_code` (kod spalany także przy błędnym verifierze), weryfikacja PKCE, wydanie tokena `epm_…` z `expires_at = now + 30 dni` (`OAUTH_TOKEN_TTL_SECONDS`). Audit `oauth.token_issued`.
- `api/_lib/oauth.ts` - `parseRedirectUri`: ścisły walidator używany identycznie w authorize/code/token. Dozwolone tylko `https://claude.ai` i `https://app.claude.ai` (domyślny port) oraz loopback `localhost` / `127.0.0.1` (http/https, dowolny port); odrzuca białe znaki, znaki kontrolne, backslash, fragment `#`, userinfo, długość > 2048.

## Uprawnienia

Klient service_role omija RLS, wiec MCP odtwarza polityki w kodzie:

- **Rola** - aktualna rola wlasciciela tokena (z `mcp_consume_token`, nie z `mcp_tokens.scopes`). Narzedzia z `roles: POSEL_ONLY` sa niewidoczne w `tools/list` Pracownika, a `tools/call` zwraca blad. Asystent nie dostaje tokena.
- **Kanal** - `channels: POLIAI_ONLY` (`api/_lib/tools/types.ts`) ukrywa narzedzie przed `/api/mcp`: nie ma go w `tools/list`, a `tools/call` zwraca ten sam blad co dla nieznanego narzedzia (`getTool(name, channel)`, dodatkowo `callTool` odrzuca). Dotyczy administracji kont i konfiguracji: `users_update` (rola, `is_active`, `scope_*`) i `settings_update` - dostepne tylko w PoliAI, gdzie kazdy zapis zatwierdza uzytkownik. Nowe narzedzie zmieniajace role, aktywnosc, zakresy danych, sekrety, dane logowania albo trwala konfiguracje systemu zewnetrznego lub wlasnej instancji MUST dostac `channels: POLIAI_ONLY`.
- **Adnotacje** - `tools/list` zwraca `title` i `annotations: { title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint }` (nazwy ze specyfikacji MCP) z flag `ToolDefinition`: `readOnly` (odczyt), `nonDestructive` (zwykły zapis), `idempotent`, `openWorld` (adres ICS). Zapis bez `nonDestructive` = `destructiveHint: true` (zachowawczo): usuwanie, `interpellations_decide`, `interpellations_mark_sent`, `budget_receipt_attach` (podmiana usuwa stary plik), `users_update`, `ics_sources_delete`. Potwierdzenia po stronie serwera (argument `confirm`) celowo nie ma - model pod prompt injection podałby go równie łatwo; barierą jest zgoda człowieka w kliencie i kanały. Pole `title` jest wymagane w `ToolDefinition`.
- **Treść spoza biura** (prompt injection) - rekordy ze źródeł zewnętrznych dostają addytywnie `niezaufana_tresc: true` i `niezaufane_pola` (`markCase` / `markEvent` / `markAuditEntry` w `types.ts`): sprawy `source = 'public_form'` (tytuł, opis, dane zgłaszającego), wydarzenia z `ics_source_id` (tytuł, opis, miejsce), wpisy `audit_log` bez autora (metadane). Instrukcje `initialize` (i system prompt PoliAI) każą traktować te pola jako dane, nigdy polecenia. `cases_list` zwraca `source` i ma filtr `source`.
- **Publikacja** - narzędzia nie publikują na stronie publicznej: `events_create` / `events_update` odrzucają `is_public` (błąd walidacji; przełącznik tylko w `EventFormDialog`), a w kanale `mcp` `events_update` nie zmienia wydarzeń z `is_public = true` (treść widzi anon przez `get_public_upcoming_events`). PoliAI może je edytować (zapis zatwierdzany w panelu). Pozostałe pola publiczne (`profiles.is_public`, biura, `site_identity`) zmieniają tylko narzędzia `POLIAI_ONLY` albo UI.
- **Zakres danych** - `applyDataScope` na kazdym odczycie i modyfikacji `cases` / `contacts` / `events` / `interpellations`: przy `scope_* = 'own'` tylko `created_by = ja` (+ `assigned_to = ja` dla spraw i wydarzen). Kolejne `.or()` PostgREST laczy przez AND, wiec filtr nie koliduje z wyszukiwaniem.
- `cases_get` zwraca timeline z `audit_log` tylko Poslowi (RLS `audit_log_select_posel`).
- Inserty z MCP ustawiaja `created_by` jawnie (trigger `set_created_by` pod service_role dostaje NULL).

## Tools

Nazwy z podkreslnikiem (`cases_list`). P = Posel, Pr = Pracownik.

| Modul | Narzedzia | Role |
|-------|-----------|------|
| Moje dane | `me_profile` (profil, biuro, zespol biura, zakres danych), `me_agenda` (otwarte sprawy przypisane do mnie + przeterminowane, moje wydarzenia na N dni, niewyslane interpelacje) | P, Pr |
| Przeglad i status | `me_briefing` (pierwsze wywolanie rozmowy; P: Puls Biura - wynik 0-100, stan, obszary z sygnalami i opiekunami, interpelacje do decyzji i po terminie, przeterminowane sprawy, najblizsze wydarzenia, `sugerowane_kroki`; Pr: moje obszary z sygnalami, `sugerowane_dzialania` z obowiazkow, moje sprawy/terminy/interpelacje, `mozesz_tez`; liczniki w sugestiach Pracownika - wydarzenia na 14 dni, powiaty bez wizyty, zaakceptowane interpelacje po terminie - licza tylko dane z jego `scope_*`), `person_status` (obszary osoby + sygnaly + trend tydzien/miesiac vs poprzedni do tego samego momentu + 8 tygodni; P: dowolna osoba, Pr: tylko siebie) | P, Pr |
| Slowniki | `powiaty_list`, `gminy_list`, `case_categories_list`, `expense_categories_list` | P, Pr |
| Sprawy | `cases_list`, `cases_get`, `cases_create`, `cases_update_status`, `cases_add_note`, `cases_update` / `cases_delete` | P, Pr / P |
| Kontakty | `contacts_list`, `contacts_get`, `contacts_search`, `contacts_create`, `contacts_update` / `contacts_delete` | P, Pr / P |
| Kalendarz | `events_list_upcoming`, `events_create`, `events_update` / `events_delete` | P, Pr / P |
| Interpelacje | `interpellations_list`, `interpellations_get`, `interpellations_mark_sent` (P, Pr); `interpellations_submit`, `interpellations_resubmit` (Pr); `interpellations_decide`, `interpellations_delete` (P) | P, Pr |
| Budzet | `budget_list` (pole `missing_invoice_file` = brak pliku faktury/paragonu, filtr `missing_invoice_file`, licznik `missing_invoice_file_count`), `budget_get` / `budget_create`, `budget_update`, `budget_delete`, `budget_receipt_upload_url` + `budget_receipt_attach` (tylko /api/mcp: plik faktury przez signed upload URL bucketu `receipts`, klient wysyla PUT, attach sprawdza naglowek pliku i zgodnosc z Content-Type, podpina `receipt_path`; podmiana tylko z `replace: true`) | P, Pr / P |
| Audit | `audit_list` | P |
| Zespol | `users_list`, `users_get` (Pracownik: katalog - imie, email, telefon, rola, biuro; Posel: + scope_*, password_set, last_sign_in_at, MFA) / `users_update` (tylko PoliAI) | P, Pr / P |
| Biura | `offices_list` (opcjonalnie ze skladem) / `offices_create`, `offices_update` (tylko PoliAI; is_main przenoszone z poprzedniego) | P, Pr / P |
| Ustawienia | `settings_list` (allow-lista kluczy `READABLE_KEYS` w `settings.ts` - nowy klucz `app_settings` jest niewidoczny, dopoki nie zostanie dopisany; klucze API zamaskowane; Pracownik: tylko `newsletter_defaults`) / `settings_update` (tylko PoliAI) | P, Pr / P |
| Kalendarze ICS | `ics_sources_list` / `_create`, `_update`, `_delete`, `_sync` (tylko PoliAI) | P |

Reguly `users_update`: brak zmiany wlasnej roli i dezaktywacji wlasnego konta; rola inna niz Posel wymaga aktywnego biura; `scope_*` tylko dla rol innych niz Posel.
Reguly `settings_update`: `visibility_alert_days` 1-3650, `newsletter_defaults` zmiana czesciowa (tylko istniejace pola), `getresponse_*` tekst; `getresponse_api_key` tylko z UI.
Nazwy pol wyboru (`api/_lib/tools/labels.ts`): wyniki spraw, kontaktow, wydarzen, interpelacji, wydatkow i `me_briefing` maja obok identyfikatora nazwe - `category_name`, `powiat_name`, `gmina_name`, `assigned_to_name`, `created_by_name`, `signatory_name`. Do zapisu model dobiera id ze slownikow (`*_list`), bez pytania uzytkownika o numery.

Pulse w MCP: `service_module_pulse()` / `service_person_pulse(uuid)` (migracja `20261025100000_mcp_pulse_service.sql`, tylko service_role) - ta sama logika co `get_module_pulse` / `get_person_pulse` (wspolne `module_pulse_core` / `person_pulse_core`), bo MCP nie ma `auth.uid()`. Wysylki newslettera `briefing.ts` ocenia z GetResponse (`getresponse_api_key`, timeout 5 s; blad = `uwagi.wysylki_newslettera: 'niedostępne'`).

## Prompty (procedury)

`initialize` zglasza `prompts`; instrukcje rozne dla Posla i Pracownika (start od `me_briefing`). `prompts/list` filtrowane po roli, `prompts/get` audytowane (`mcp.prompt_get`, fail-closed). Plik `api/_lib/prompts.ts`.

| Rola | Prompty |
|------|---------|
| Posel / Administrator | `poranny_przeglad`, `decyzje_do_podjecia` (decyzja tylko po zgodzie), `status_zespolu` (opcjonalny argument `osoba`) |
| Pracownik | `moj_plan_na_dzis`, `co_poprawic` (poprawki interpelacji tylko po zgodzie), `raport_tygodniowy` (raport dla Posla: Zrealizowane / W toku / Problemy / Plan) |

Dane posła (jedna instancja = jeden poseł) w promptach pochodzą z `app_settings.site_identity`, nie z kodu: loader `api/_lib/siteIdentity.ts` (`getSiteIdentity()` - service client, luźna walidacja, cache 5 min, przy błędzie/braku neutralne wartości; `mpForms(gender)` - formy "Poseł"/"Posłanka" jak `src/lib/mpForms.ts`; `officeFullName(identity)`). `listPrompts` i `renderPrompt` są async; opisy i treść promptów dostają formy z `mp_gender` (`description(forms)`, `build(args, ctx, forms)`). Prompty nie wymieniają konkretnych osób biura - odsyłają do opiekunów obszarów (`me_briefing`, `module_owners`). Ten sam loader buduje wstęp system promptu PoliAI (`api/_lib/poliai/prompt.ts`: "systemie biura poselskiego {mp_name_genitive} ({district_label})", bez danych - neutralnie; identity w stałej, cache'owanej części promptu).

## Audit Log

Kazda akcja w MCP zapisuje do `audit_log`:
- `mcp.tool_call` - dla kazdego wywolania tools/call (z `args_keys` w metadata; nie logujemy wartosci zeby nie wycinkowac PII).
- `mcp.*` - markery operacji (np. `mcp.case_create`, `mcp.user_update`, `mcp.office_update`, `mcp.setting_update`, `mcp.ics_source_sync`) oprocz triggerow.
- `case.note` - notatka dodana przez `cases.add_note`.
- `mcp_token.create` / `mcp_token.revoke` - operacje na samych tokenach.

Wszystkie te akcje maja `metadata.via_mcp=true` + `metadata.token_id` (UUID tokena).

## Frontend

### `/biuro/admin/integracje` (Pose-only)

- Lista tokenow: nazwa / prefix / status (Aktywny|Wygasł|Unieważniony) / last_used / created / „Ważny do”.
- Przycisk "Wygeneruj token" -> `CreateMcpTokenDialog` (nazwa + ważność 30/90/180 dni, domyślnie 90 -> reveal once + instrukcja).
- Akcja "Unieważnij" -> `RevokeMcpTokenDialog` (confirm dialog).

### Komponenty

- `src/pages/admin/Integracje.tsx` - strona.
- `src/hooks/useMcpTokens.ts` - useMcpTokens / useCreateMcpToken / useRevokeMcpToken.
- `src/components/admin/CreateMcpTokenDialog.tsx` - form + reveal + copy + close (plain niedostepny po zamknieciu).
- `src/components/admin/McpConfigInstructions.tsx` - blok JSON `claude_desktop_config.json` + URL endpointu.
- `src/components/admin/RevokeMcpTokenDialog.tsx` - confirm dialog.

### Routing & nav

- Route `admin/integracje` pod `RoleGuard allow={['posel']}` w `src/App.tsx`.
- Pozycja w `src/components/layout/Sidebar.tsx` (sekcja Administracja, ikona `Plug`, kolor fuchsia-600).

## Bezpieczenstwo

- Token plaintext **tylko raz** widoczny (sha256 hash w DB, brak mozliwosci re-display).
- `create_mcp_token` wymaga `aal2`; token dostaje Posel i Pracownik, asystent dostaje 42501. Token działa bez 2FA, więc zawsze wygasa (max 180 dni).
- `mcp_consume_token` REVOKE od authenticated/anon - wykonywany tylko z service_role w Vercel.
- W api/mcp.ts guard roli (`posel` | `pracownik`) + uprawnienia z sekcji "Uprawnienia" (defense-in-depth wzgledem RLS).
- Audit kazdego tools/call z `via_mcp=true`.
- Soft-delete (revoked_at) - zachowanie historii ze podgladem ze token byl uzywany.
- Tokeny OAuth wygasają po 30 dniach; unieważnienie OAuth App unieważnia jej tokeny. Zgoda OAuth wymaga sesji aal2, kod autoryzacyjny jest jednorazowy (atomowe zużycie), `redirect_uri` ściśle walidowany.
- Klucze API (`getresponse_api_key`, `anthropic_api_key`, `resend_api_key`) są zaszyfrowane w Supabase Vault; MCP czyta je tylko przez service_role (`service_get_secrets`), `settings_list` pokazuje je zamaskowane. Dla klientów portalu niedostępne (zapis tylko RPC `set_secret_setting` z UI).

## Workflow uzytkownika

1. Pose -> `/biuro/admin/integracje` -> "Wygeneruj token".
2. Wpisuje nazwe (np. "Macbook biuro") -> "Wygeneruj".
3. Dialog pokazuje plain token + przycisk "Skopiuj" + JSON snippet.
4. Wkleja snippet do `claude_desktop_config.json` (Settings -> Developer -> Edit Config w Claude Desktop).
5. Restart Claude Desktop -> serwer pojawia sie jako `biuro` z narzedziami.
6. Pose pisze: *"Pokaz nadchodzace wydarzenia"* -> Claude wola `events_list_upcoming` -> dane wracaja.

## Notatki / Ograniczenia v1

- Token moze utworzyc Posel i Pracownik (migracja `mcp_extend_roles`); uprawnienia egzekwowane po roli i zakresie danych.
- Bez SSE / Streamable HTTP - jezeli claude.ai (web) bedzie tego wymagac, dorzucic w v2.
- OAuth tylko dla claude.ai (Authorization Code + PKCE); Claude Desktop nadal używa tokena statycznego.
- Tokeny ręczne wygasają po 30/90/180 dniach (wybór przy tworzeniu), OAuth po 30 dniach; brak wygasania po bezczynności i brak odświeżania - po terminie użytkownik generuje nowy token.
- Rate limiting - polegamy na Vercel function limits + Supabase. W razie naduzycia: per-token RPS limiter w `api/mcp.ts`.
- `scopes` w `mcp_tokens` nie sa egzekwowane - decyduje aktualna rola z `profiles` (degradacja roli dziala od razu, bez wymiany tokena).

## Historia Zmian

| Data | Zmiana |
|------|--------|
| 2026-11-16 | Bramka `INSTANCE_AI` (ADR 028): `rejectIfAiDisabled` na poczatku `api/mcp.ts` (GET i POST; preflight CORS przechodzi) i wszystkich `api/oauth/*`. Kanal `portal` w `ToolChannel` dla recznych operacji interpelacji (`api/integracje.ts`) - `isToolExposed` nie pokazuje w nim zadnego narzedzia, audyt przez `service_log_audit` (bez `via_mcp`). `interpellations_submit` / `interpellations_resubmit` wolaja wspolne `submitInterpellation` / `resubmitInterpellation`; resubmit waliduje UUID i zwraca blad walidacji przy niezmienionej tresci (22023). |
| 2026-11-10 | Przegląd bezpieczeństwa (API-MCP-1/2/4/5): adnotacje MCP z `idempotentHint` / `openWorldHint` i klasą zapis vs destrukcyjne (`nonDestructive`, `idempotent`, `openWorld` w `ToolDefinition`); znacznik `niezaufana_tresc` + `niezaufane_pola` dla spraw z formularza publicznego, wydarzeń ICS, wpisów audytu bez autora, reguła w instrukcjach `initialize`; `events_*` bez `is_public`, kanał `mcp` nie zmienia wydarzeń publicznych; `cases_list` z `source` i filtrem; liczniki `me_briefing` Pracownika wg `scope_*`; opisy bez danych pierwszej instancji; `isAal2Session(jwt, user)` wymaga zweryfikowanego czynnika; `scopeOf` bez wartości = `own`; `create_mcp_token(p_name, p_days default 90)` (1-180 dni), `expires_at NOT NULL`, UI z wyborem ważności. Migracja `20261110120000_mcp_token_expiry.sql`. |
| 2026-11-07 | Rebranding: `serverInfo.name` `office-mcp` (tytul = `officeFullName`), klucz w snippecie Claude Desktop `biuro`, bez nazwy ePosel w instrukcjach i bledach OAuth. |
| 2026-11-07 | Instancja dowolnego posła: `api/_lib/siteIdentity.ts` (dane z `app_settings.site_identity`, cache 5 min), prompty MCP i system prompt PoliAI bez nazwiska/okręgu w kodzie, formy "Poseł"/"Posłanka" z `mp_gender`; `raport_tygodniowy` bez osób biura (odesłanie do opiekunów obszarów); opis `powiaty_list` bez numeru okręgu. `listPrompts`/`renderPrompt`/`buildSystemPrompt` async. |
| 2026-10-25 | Procedury per rola: `me_briefing` i `person_status` (`api/_lib/tools/briefing.ts`), prompty MCP (`api/_lib/prompts.ts`, `prompts/list` / `prompts/get`, audit `mcp.prompt_get`), instrukcje `initialize` rozne dla Posla i Pracownika. Migracja `20261025100000_mcp_pulse_service.sql` (`service_module_pulse`, `service_person_pulse`, wspolne rdzenie z funkcjami aplikacji). |
| 2026-10-21 | OAuth dla Pracownika: migracja `20261021100000_oauth_pracownik.sql` (`create_oauth_client` akceptuje posel + pracownik), `/api/oauth/code` wpuszcza role MCP, `/api/oauth/token` sprawdza aktywność i rolę właściciela oraz ustawia `scopes` wg roli. UI (zgoda OAuth, strona MCP) opisuje uprawnienia wg roli zamiast "uprawnień Posła". Wymaga wcześniejszego wgrania `20261018200000` i `20261018210000`. |
| 2026-10-18 | Audyt bezpieczeństwa: `mcp_tokens.expires_at` (OAuth 30 dni, ręczne NULL), `mcp_consume_token` odrzuca tokeny wygasłe i unieważnionej OAuth App, `revoke_oauth_client` unieważnia tokeny aplikacji, `oauth_consume_code` (atomowe zużycie kodu), ścisły walidator `redirect_uri` (`api/_lib/oauth.ts`), zgoda `describe` / `approve` / `deny` przez `POST /api/oauth/code` z wymogiem aal2 (`api/_lib/jwt.ts`), audit OAuth przez `service_log_audit`, batch JSON-RPC max 10. Migracja `20261018200000_security_audit_settings_oauth.sql`. |
| 2026-10-18 | Administracja i "moje dane" w MCP: `me_profile`, `me_agenda`, `users_list/get/update`, `offices_list/create/update`, `settings_list/update`, `ics_sources_list/create/update/delete/sync`. Bramka roli deklaratywna (`roles`) + filtrowanie `tools/list`. Fix wycieku: zakres `scope_* = own` egzekwowany w narzedziach spraw/kontaktow/wydarzen/interpelacji, timeline audytu tylko dla Posla, `interpellations_generate_draft` tylko Posel, inserty interpelacji ustawiaja wymagane `signatory_id`. |
| 2026-05-08 | Dodano `delete_mcp_token` RPC + UI: usuwanie unieważnionych tokenów (przycisk "Usuń" zastępuje "Unieważnij" w wierszach revoked). Aktywne tokeny chronione - wymagany wcześniejszy revoke. |
| 2026-05-07 | Init feature: tabela `mcp_tokens` + 4 RPC, Vercel `/api/mcp` (JSON-RPC) z 13 tools, `/biuro/admin/integracje` (Pose-only) z generowaniem/revoke. |

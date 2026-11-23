# Legatto self-host: strona posła, formularz, panel admin, eksport (A5–A8, A12, A13, U11)

Zmiany aplikacji dla instalacji na VPS biura (legatto-infra, PLAN sekcja D). Tryb Vercel / Supabase Cloud działa dalej do cutoveru ostatniej instancji.

## A5. Powierzchnia admin

- Proxy (Caddy) ustawia `X-Legatto-Surface: crm` na `app.<domena>` i `admin` na `admin.app.<domena>`, nadpisując wartość klienta.
- Baza: `public.require_admin_surface()` (migracja `20261121200000_admin_surface.sql`). Wymuszanie przy braku nagłówka: GUC `legatto.surface_enforce=on`, ustawiany przez serwer bazy VPS.
- Funkcje Edge `admin-*` i `admin-export-data`: `supabase/functions/_shared/surface.ts`, env `LEGATTO_SURFACE_ENFORCE=1`. Poza powierzchnią admin zwracają 404.
- UI: `src/lib/adminSurface.ts`, `AdminSurfaceNotice` (link do tej samej ścieżki na `admin.app`). Na `crm` akcje wrażliwe w Użytkownikach i eksport są ukryte.

## A6. Strona posła (`site/`)

- Generator: istniejące komponenty publiczne React renderowane SSR (`renderToString`) plus wyspy hydratowane w przeglądarce (formularz, kalendarz), budowane Vite (`pnpm build:site` → `site/dist/{client,server}`).
- Astro odrzucone: drugi framework i toolchain w obrazie runtime, a komponenty i tak są w React.
- CLI w obrazie `app`: `node /app/server/site.mjs claim|snapshot|build|finish`. Kontrakt z torem publicsite (legatto-infra): `site-publisher`, `legatto-site-publish`.
- Dane: wyłącznie `public.service_site_snapshot()` (rola DB `legatto_publisher`). Kolejka zadań: `site_publish_jobs`, RPC `request_site_publish()`, `service_site_publisher_claim/finish`. Codzienna przebudowa po 03:30.
- Strażnik zero-adres w `build` (kod 20).
- Tryb Vercel: `/` w SPA czyta tę samą migawkę z `GET /api/public-site`.
- Anon traci dostęp do `get_public_*` i słowników w etapie contract: `supabase/migrations-contract/revoke_anon_public.sql`. Trafi do `supabase/migrations/` w pierwszym wydaniu po `v0.1.0`.

## A7. Formularz szyfrowany i intake

- `packages/public-submission`: schemat (reguły „czysty tekst”), koperta v1 (25 278 B, magic `LGF1`, podpis Ed25519 Workera), sealed box zgodny z libsodium (`@noble/*`). Wektory: `test/vectors.json`, generator `test/generate-vectors.ts`.
- Przeglądarka szyfruje formularz kluczem biura (`/data/form-key.json`) i wysyła `POST /api/submit` do Workera.
- `server/intake` (`node /app/server/intake.mjs`), dwa procesy (R9):
  - `fetch`: token kolejki, sieć, bez klucza i bazy → `inbox/`; potwierdza w kolejce tylko z `acks/`;
  - `process`: klucz X25519 i baza, bez sieci → `acks/`, `quarantine/`;
  - `keygen`, `selftest`.
- Baza: `intake.submit_public_case(jsonb)` (jedyny EXECUTE roli `legatto_intake`). Idempotentna po `id` z plaintextu, limity 3/h na hash IP i 60/h globalnie, `cases.public_ref`. Retencja pokwitowań 30 dni.

### Cutover

`supabase/functions/public-submit-case` zostaje do przeniesienia ostatniej instancji z Vercela. Na VPS proxy blokuje ją na `crm`, a formularz idzie przez Worker. Po cutoverze usuń:

- funkcję `public-submit-case` i sekrety `TURNSTILE_SECRET`, `PUBLIC_SUBMISSION_IP_SALT`;
- `src/lib/publicSubmitEdge.ts` i strategię `edge` formularza;
- `api/newsletter-view.ts` z rewrite `/n/:slug` (wersja online jest statyczna na stronie posła);
- `api/public-site.ts`, jeśli SPA nie musi już pokazywać strony publicznej.

## A8. Newsletter

- Ustawienie `app_settings.public_site_url` (origin `https://…` albo pusty = tryb portalu).
- Gdy ustawione, wersja online jest pod `${public_site_url}/n/<slug>`, a obrazy pod `/n/a/<sha256>.<ext>`, publikowane przez generator strony.
- Wysyłka: najpierw `request_newsletter_publication()`, potem czekanie na `web_published_at`. `getresponse-proxy` odrzuca wysyłkę (409) bez publikacji. Treść zgłoszonego wydania jest zamrożona (trigger).

## A12. Blog

Tabela `posts` (RLS Poseł/Administrator z aal2, audyt `post.*`), edytor `/biuro/admin/blog` (Markdown bez surowego HTML, okładki w `site-assets/blog/`). Wpisy trafiają na stronę przez A6 (`/blog/`, `/blog/<slug>/`).

## A13. Eksport danych dla posła

- `/biuro/admin/eksport-danych`, tylko powierzchnia admin, Poseł/Administrator z 2FA.
- Funkcja Edge `admin-export-data` strumieniuje ZIP AES-256 (WinZip AE-2, hasło posła 12–128 znaków): `tables/*.jsonl`, `files/<bucket>/…`, `manifest.json`.
- Tabele i pliki pobiera RPC `export_office_data` / `export_office_files` tokenem użytkownika. Baza sprawdza powierzchnię, rolę i aal2.
- Bez sekretów (hashe tokenów, PIN-y, klucze API, push, zaufane urządzenia, adresy ICS).
- Audyt: `data.export_started|finished|failed`.

## U11. Rozszerzenie Claude Desktop (`mcpb/`)

`node mcpb/build.mjs` → `mcpb/dist/legatto.mcpb`. Proxy stdio ↔ `https://app.<domena>/api/mcp` (tylko tailnet), logowanie OAuth jak w aplikacji albo token MCP. Instrukcja: `mcpb/README.md`.

## Testy

- `pnpm test` (vitest): `packages/public-submission`, `server/intake`, `supabase/functions/admin-export-data`, `site/`, UI.
- `node_modules/.bin/vitest run --config mcpb/vitest.config.mjs`.
- `supabase/tests/run-features.sh`: świeży Postgres Supabase w Dockerze z migracjami GoTrue/Storage, wszystkie migracje, drugi przebieg nowych (idempotencja), etap contract, asercje SQL A5–A8, A12, A13.

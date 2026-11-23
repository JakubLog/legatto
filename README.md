# Legatto

System pracy biura poselskiego (legatto-app): publiczna strona posła (zgłoszenia, biura, kalendarz) i portal `/biuro`
dla zespołu (sprawy, kontakty, kalendarz, interpelacje, budżet, dokumenty do podpisu, newsletter, PoliAI, MCP).

Produkt nazywa się Legatto. Nazwa występuje w interfejsie tylko w stopce „This is Legatto. Built by no-fuss.”
(`src/components/common/ProductCredit.tsx`: panel, ekrany logowania, strona publiczna). Nie dodawaj jej nigdzie indziej.

Stack: Vite + React + TypeScript + Tailwind + shadcn, Supabase (Postgres, Auth, Storage, Edge Functions),
Vercel (frontend + `api/`), pnpm. Dokumentacja projektu: `ai-lib/context-map/INDEX.md`.

## Uruchomienie lokalne

```bash
pnpm install
cp .env.example .env.local   # uzupełnij VITE_*
pnpm dev
```

`pnpm dev` słucha tylko na localhost (funkcje `api/` działają tam z kluczem service_role z `.env.local`); dostęp z sieci
lokalnej: `VITE_DEV_HOST=0.0.0.0 pnpm dev`. Do pracy lokalnej używaj lokalnego Supabase (`supabase start`), nie produkcji;
`supabase/config.toml` bierze adresy Auth z `INSTANCE_SITE_URL` / `INSTANCE_LOGIN_URL` w `.env.local` (`.env.example`).

Kontrole: `pnpm exec tsc -b`, `pnpm exec tsc -p api`, `pnpm exec tsc -p server`, `pnpm lint`, `pnpm test` (vitest),
`pnpm build` (build wymaga `VITE_SUPABASE_URL` - z niego powstaje CSP), `scripts/ci/deno-check.sh` (Edge Functions),
`node scripts/lint-migrations.mjs`. CI (`.github/workflows/ci.yml`, akcje przypięte po SHA, bez sekretów) uruchamia
dla PR i `main` joby `check`, `functions`, `migrations`, `compat-n-1`, `images` i `secrets` (opis: "Serwer biura").

## Nowa instancja (inny poseł)

Model: **jedna instancja = jeden poseł** (ADR 026) - osobny projekt Supabase, osobny projekt Vercel, osobna domena.
Kod, `vercel.json` i migracje są wspólne; dane posła są tylko w bazie (`app_settings`) i w Storage (`site-assets`).

1. **Okręg** - `node scripts/build-okreg-geojson.mjs <nr>` (definicje 41 okręgów w `scripts/districts/`, wymaga lokalnego
   `geo-source/`), commit `public/geo/okreg-<nr>-*.geojson`; seed słowników trafia do `scripts/districts/out/`.
2. **Cloudflare Turnstile** - nowa witryna dla domeny instancji (site key + secret key).
3. **Supabase - provisioning** - nowy projekt (region UE; inny region zatrzymuje skrypt), potem
   `SUPABASE_ACCESS_TOKEN=sbp_... TURNSTILE_SECRET=... AUTH_SMTP_PASS=... node scripts/instances/provision.mjs <ref> <domena>`
   (najpierw z `--dry-run`). Skrypt przez Management API ustawia Auth (rejestracja wyłączona - ADR 002, `site_url` i
   jedyny redirect `https://<domena>/login`, hasło 12 znaków / 4 klasy, TOTP, rotacja refresh tokenów, reautoryzacja
   i obecne hasło przy zmianie hasła, neutralne zaproszenie z `supabase/templates/invite.html`), na planie Pro HIBP
   i limity sesji, wymuszenie SSL do Postgresa i sekrety Edge (`ALLOWED_ORIGINS`, `AUTH_REDIRECT_URL`,
   `TURNSTILE_SECRET`, `PUBLIC_SUBMISSION_IP_SALT` - losowa, tylko gdy jej nie ma). Skrypt jest idempotentny.
   Własny SMTP Auth (zaproszenia, linki logowania; domyślny SMTP Supabase wysyła tylko do zespołu projektu):
   `AUTH_SMTP_PASS` (klucz SMTP, np. Resend) oraz opcjonalnie `AUTH_SMTP_HOST` (domyślnie `smtp.resend.com`),
   `AUTH_SMTP_PORT` (465), `AUTH_SMTP_USER` (`resend`), `AUTH_SMTP_SENDER_EMAIL` (`no-reply@<domena>`, domena
   zweryfikowana u dostawcy), `AUTH_SMTP_SENDER_NAME`; bez `AUTH_SMTP_PASS` krok SMTP jest pomijany z ostrzeżeniem.
   Nie używaj `supabase config push` do produkcji (`config.toml` służy lokalnemu `supabase start`).
4. **Supabase - schemat i funkcje** - `supabase link --project-ref <ref>`, `supabase db push --linked` (migracje,
   buckety storage, RPC); okręg inny niż 35: `supabase db query --linked -f scripts/districts/out/okreg-<nr>-seed.sql`
   (na pustej bazie); `supabase functions deploy` (wszystkie Edge Functions; `db push` ich nie wdraża). Instancja sprzed
   usunięcia `ai-proxy`: `supabase functions delete ai-proxy` (doctor zgłasza ją jako FAIL).
5. **Vercel** - nowy projekt z tego repo, zmienne z `.env.example` (sekcje VITE_ i Vercel Functions, w tym
   `VITE_SUPABASE_URL` - z niego build generuje CSP instancji, i `VITE_APP_TITLE`), domena. `OAUTH_ISSUER` jest
   opcjonalny (domyślnie `https://$VERCEL_PROJECT_PRODUCTION_URL`), ale **wymagany**, gdy projekt ma kilka domen
   produkcyjnych. Alias `*.vercel.app` przekieruj na domenę instancji albo usuń (inaczej serwuje produkcję drugim
   originem). HSTS jest bez `includeSubDomains`/`preload`, więc instancja może stać na domenie głównej klienta.
   **Dodatki instancji** ustawia operator w env, nie panel (opis zmiennych: `.env.example`): `INSTANCE_AI=on|off`
   (PoliAI, raporty AI, OCR), `INSTANCE_MCP=on|off` (serwer MCP i OAuth dla Claude, niezależnie od AI),
   `INSTANCE_EMAIL=on|off` (e-maile powiadomień przez Resend) - brak wartości = `off`; `INSTANCE_PUSH`,
   `INSTANCE_GETRESPONSE`, `INSTANCE_ICS` (brak = `on` na Vercelu) i `ICS_ALLOWED_HOSTS` (lista hostów kalendarzy ICS,
   brak = bez ograniczenia). Flagi czyta serwer i build frontendu, więc zmiana wymaga ponownego wdrożenia. Opcjonalnie
   klucz i modele AI operatora (`AI_API_KEY`, `AI_MODEL`, `AI_FAST_MODEL`) - mają pierwszeństwo przed Integracje → AI;
   z `AI_API_KEY` model wybiera tylko operator (`AI_MODEL` albo domyślny), nie panel.
6. **Kontrola** - `SUPABASE_ACCESS_TOKEN=sbp_... node scripts/instances/doctor.mjs <domena> <ref> --ai=on|off --mcp=on|off`
   (tylko odczyt; kod wyjścia 1 przy FAIL). Uruchamiaj po każdym wdrożeniu: sprawdza m.in. rejestrację, Auth, SMTP,
   region UE, sekrety, `verify_jwt`, powierzchnię `anon`, CSP z refem tej instancji, issuer OAuth, crony
   (`CRON_SECRET`), bramki AI (`--ai` albo `INSTANCE_AI`: przy `off` `/api/poliai` zwraca 404 `AI_DISABLED`) i MCP
   (`--mcp` albo `INSTANCE_MCP`: przy `off` `/api/mcp`, OAuth i discovery zwracają 404 `MCP_DISABLED`) oraz zgodność
   migracji z repo.
7. **Pierwszy Poseł** - konto w Auth + wiersz w `profiles` z rolą `posel` (`ai-lib/context-map/infrastructure/database.md`,
   sekcja "Seed pierwszego Posła"). Kolejne konta tworzy Poseł w panelu.
8. **Dane posła** - panel `/biuro/admin/strona-główna` (imię i nazwisko, forma Poseł/Posłanka, okręg, zdjęcie, treść
   strony; zdjęcie trafia do bucketu `site-assets`). Z tych danych korzystają też portal, wydruki, 2FA, PoliAI, MCP
   i newsletter. Wszystkie dane posła wprowadza się w panelu; repozytorium nie zawiera danych żadnej instancji.
9. **Ustawienia w panelu** - limit budżetu (Budżet → Ustaw limit), klucz AI (Integracje → AI; przy `INSTANCE_AI=on`
   i bez `AI_API_KEY`), GetResponse (nadawca), Resend (przy `INSTANCE_EMAIL=on`), stałe newslettera (stopka, e-mail,
   polityka prywatności, region), ICS, biura, podział obowiązków.

**Ręcznie (poza skryptami):**
- plan Pro dla projektu Supabase: kopie dzienne / PITR, HIBP, limity sesji (po zmianie planu uruchom `provision.mjs`
  ponownie); do tego czasu kopie `scripts/instances/backup.sh dump` (szyfrowane `age`, odtworzenie: `backup.sh restore`),
- Supabase → Database → Network restrictions: zawężenie dostępu do Postgresa (aplikacja używa tylko HTTPS API),
- Vercel: domena, alias `*.vercel.app`, ochrona wdrożeń podglądowych.

Kolejność wdrożenia zmian schematu: migracja → `supabase functions deploy` (gdy zmieniły się funkcje) → deploy
frontendu → `doctor.mjs`. Działająca instancja bez `INSTANCE_AI` / `INSTANCE_MCP` / `INSTANCE_EMAIL` po wdrożeniu traci
AI, MCP i e-maile (brak = `off`) - ustaw zmienne w Vercelu przed wdrożeniem. **Aktualizacja do wersji z osobną flagą
MCP:** instancja, która używa MCP (dawniej włączanego przez `INSTANCE_AI=on`), musi mieć `INSTANCE_MCP=on` w Vercelu
przed wdrożeniem, inaczej `/api/mcp` i OAuth zwrócą 404, a klienci MCP stracą połączenie.

**Ustawienia per instancja** (domyślnie okręg 35, do zmiany przy każdej instancji):
- `.mcp.json` - w URL serwera Supabase MCP zamień `project_ref=<project-ref>` na ref projektu Supabase danej instancji,
- seed `app_settings.district` = okręg 35 (spójny ze słownikami),
- słowniki powiatów i gmin okręgu 35 (podmień skryptem z punktu 4).

## Serwer biura (self-host)

Ten sam kod działa też na VPS biura (infrastruktura: repo `legatto-infra`, które składa podpisane paczki wydań).
Tryb włącza `LEGATTO_TARGET=selfhost` w env kontenera: SPA czyta konfigurację z `/runtime-config.js` (adres Supabase
= origin strony, klucze publiczne, tytuł `APP_TITLE`, flagi), a `server/` uruchamia `api/**` z regułami `vercel.json`
(`:3000` publicznie przez Caddy, `:3001` wewnętrznie: `/healthz`, hook maili Auth). Na VPS `INSTANCE_PUSH`,
`INSTANCE_GETRESPONSE` i `INSTANCE_ICS` są domyślnie `off` (opt-in admina biura), a brak `ICS_ALLOWED_HOSTS` oznacza
brak dozwolonych hostów - lista musi odpowiadać allowliście egress biura. Maile Auth wysyła Send Email Hook aplikacji
(`server/auth-email-hook.ts`), pierwszego Posła zakłada `node /app/server/first-posel.mjs --email … --name …
--delivery email|link` w kontenerze `app`.

- **Obrazy wydania** - `app` (`Dockerfile`), `functions` (`docker/functions/`, cache modułów zasiany w buildzie,
  bez sieci w runtime), `migrator` (`docker/migrator/`). `scripts/release/build-images.sh --version V --out DIR`
  buduje je powtarzalnie z zatwierdzonego `HEAD` (OCI, czasy z commitu) i zapisuje `release.json` (digesty, artefakty,
  migracje z sha256, crony z `vercel.json`, funkcje), `digests.json` i SBOM CycloneDX (`sbom/*.cdx.json`, syft).
  Workflow `release.yml` (tag `v<wersja z package.json>`) robi to samo w CI bez sekretów i bez publikacji obrazów;
  dla tagu dokłada atestację pochodzenia (OIDC). `legatto-infra` przypina `release.json` i przebudowuje obrazy -
  wynik musi być bajtowo identyczny.
- **Migrator** - `legatto-migrate migrate|status --json|check`: migracje w kolejności nazw, każdy plik w osobnej
  transakcji, sumy sha256 zastosowanych plików (zmieniony plik = kod 10). Przy pierwszej instalacji `auth` i `storage`
  muszą wystartować przed migratorem (migracje używają `auth.users` i `storage.buckets`). Serwer bazy startuje z
  `-c legatto.surface_enforce=on` (A5); migrator sprawdza to po migracjach. Test na takim stosie:
  `scripts/ci/test-migrator.sh` (`migrate` → `check` → drugi `migrate` bez zmian w schemacie).
- **Migracje i wersja N-1** - aktualizacja i rollback obrazów zostawiają bazę w nowszym schemacie, więc kod wydania N-1
  musi działać na schemacie N (expand/contract). `scripts/lint-migrations.mjs`: każda nowa migracja ma nagłówek
  `-- compat-n-1: safe|expand|contract`; DROP, RENAME, zmiana typu, SET NOT NULL itp. tylko w `contract` z
  `-- contract-after: vX.Y.Z` (tag zawarty w poprzednim wydaniu). Migracje sprzed reguły są zamrożone w
  `supabase/migrations.baseline.json`; migracja contract czekająca na swoje wydanie leży w
  `supabase/migrations-contract/`. Job `compat-n-1` (`scripts/ci/compat-n-1.sh`) stosuje migracje N na bazie po
  migracjach N-1 i sprawdza, że tabele, kolumny, uprawnienia, RPC i kubełki używane przez kod N-1 przetrwały.
- **Polityka Auth** - `supabase/selfhost/auth-policy.json` (zmienne GoTrue VPS) generuje
  `node scripts/instances/auth-policy.mjs --write` z `scripts/instances/policy.mjs`; CI (`--check`) pilnuje zgodności,
  a `legatto-infra` porównuje plik z konfiguracją usługi `auth`.

## Licencja

Copyright (C) 2026 Jakub M. Fedoszczak

Program jest udostępniony na licencji GNU Affero General Public License v3.0 (`AGPL-3.0-only`) - pełny tekst
w pliku [`LICENSE`](LICENSE). Kto udostępnia zmodyfikowaną wersję użytkownikom przez sieć, musi udostępnić im
jej kod źródłowy (sekcja 13 licencji).

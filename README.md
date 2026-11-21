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

Kontrole: `pnpm exec tsc -b`, `pnpm lint`, `pnpm build` (build wymaga `VITE_SUPABASE_URL` - z niego powstaje CSP).
To samo plus `pnpm audit --prod` uruchamia CI (`.github/workflows/ci.yml`) dla PR i `main`.

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
   (na pustej bazie); `supabase functions deploy` (7 Edge Functions; `db push` ich nie wdraża). Instancja sprzed
   usunięcia `ai-proxy`: `supabase functions delete ai-proxy` (doctor zgłasza ją jako FAIL).
5. **Vercel** - nowy projekt z tego repo, zmienne z `.env.example` (sekcje VITE_ i Vercel Functions, w tym
   `VITE_SUPABASE_URL` - z niego build generuje CSP instancji, i `VITE_APP_TITLE`), domena. `OAUTH_ISSUER` jest
   opcjonalny (domyślnie `https://$VERCEL_PROJECT_PRODUCTION_URL`), ale **wymagany**, gdy projekt ma kilka domen
   produkcyjnych. Alias `*.vercel.app` przekieruj na domenę instancji albo usuń (inaczej serwuje produkcję drugim
   originem). HSTS jest bez `includeSubDomains`/`preload`, więc instancja może stać na domenie głównej klienta.
   **Dodatki instancji** ustawia operator w env, nie panel: `INSTANCE_AI=on|off` (PoliAI, raporty AI, OCR, MCP
   i OAuth dla Claude) i `INSTANCE_EMAIL=on|off` (e-maile powiadomień przez Resend). Brak wartości = `off`; flagi
   czyta serwer i build frontendu, więc zmiana wymaga ponownego wdrożenia. Opcjonalnie klucz i modele AI operatora
   (`AI_API_KEY`, `AI_MODEL`, `AI_FAST_MODEL`) - mają pierwszeństwo przed Integracje → AI; z `AI_API_KEY` model
   wybiera tylko operator (`AI_MODEL` albo domyślny), nie panel.
6. **Kontrola** - `SUPABASE_ACCESS_TOKEN=sbp_... node scripts/instances/doctor.mjs <domena> <ref> --ai=on|off` (tylko
   odczyt; kod wyjścia 1 przy FAIL). Uruchamiaj po każdym wdrożeniu: sprawdza m.in. rejestrację, Auth, SMTP, region UE,
   sekrety, `verify_jwt`, powierzchnię `anon`, CSP z refem tej instancji, issuer OAuth, crony (`CRON_SECRET`), bramkę
   AI (`--ai` albo `INSTANCE_AI`: przy `off` `/api/poliai`, `/api/mcp` i OAuth muszą zwracać 404 `AI_DISABLED`)
   i zgodność migracji z repo.
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
frontendu → `doctor.mjs`. Działająca instancja bez `INSTANCE_AI` / `INSTANCE_EMAIL` po wdrożeniu traci AI, MCP i e-maile
(brak = `off`) - ustaw zmienne w Vercelu przed wdrożeniem.

**Ustawienia per instancja** (domyślnie okręg 35, do zmiany przy każdej instancji):
- `.mcp.json` - w URL serwera Supabase MCP zamień `project_ref=<project-ref>` na ref projektu Supabase danej instancji,
- seed `app_settings.district` = okręg 35 (spójny ze słownikami),
- słowniki powiatów i gmin okręgu 35 (podmień skryptem z punktu 4).

## Licencja

Copyright (C) 2026 Jakub M. Fedoszczak

Program jest udostępniony na licencji GNU Affero General Public License v3.0 (`AGPL-3.0-only`) - pełny tekst
w pliku [`LICENSE`](LICENSE). Kto udostępnia zmodyfikowaną wersję użytkownikom przez sieć, musi udostępnić im
jej kod źródłowy (sekcja 13 licencji).

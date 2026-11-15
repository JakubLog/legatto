# Feature: Kontakty (Faza 2)

> Baza wyborców, dziennikarzy, samorządowców, sołtysów + filtrowanie + mapa okręgu instancji.

## Cel

CRUD kontaktów z 4 wymiarami filtrowania (typ / powiat / gmina / fraza) i wizualizacja na mapie okręgu.

## Role

- **Poseł** - pełne CRUD, w tym usuwanie. Zawsze widzi wszystkie kontakty.
- **Pracownik** - read + write (bez delete). Domyślnie widzi wszystkie kontakty; Poseł moze ograniczyć przez `profiles.scope_contacts='own'` (wtedy widzi tylko `created_by = self`).
- **Asystent** - read-only. Ten sam mechanizm scope co Pracownik.

## Okręg instancji

Jedna instancja = jeden okręg do Sejmu. Konfiguracja `app_settings.district` = `{ number, highlighted_powiat_id, highlighted_gmina_id, highlight_label }` (migracja `20261107110000_district_settings.sql`, seed okręgu 35; publiczny odczyt RPC `get_public_district()` - SECURITY DEFINER, tylko ten klucz, anon + authenticated). Panel nie edytuje okręgu: zmienia się go razem ze słownikami skryptem danych instancji (niżej).

Migracja init seeduje słowniki okręgu 35 (Olsztyn) w każdej instancji - 12 jednostek (m. Olsztyn + 11 powiatów: olsztyński, ełcki, giżycki, gołdapski, kętrzyński, mrągowski, nidzicki, olecki, piski, szczycieński, węgorzewski), razem **61 gmin**. Domyślny seed: `{35, 1, 1, "Olsztyn"}`.

## Routing

| Ścieżka | Opis | Guard |
|---------|------|-------|
| `/kontakty` | Lista + filtry + opcjonalna mapa | ProtectedRoute (any active role) |

## Key Files

### Schema
- `supabase/migrations/20260425100000_init_contacts_powiaty_gminy.sql`
  - enum `contact_type` (wyborca/dziennikarz/samorządowiec/sołtys/inne)
  - tabela `powiaty` (12 wpisów z lat/lng)
  - tabela `gminy` (61 wpisów, FK do powiatu)
  - tabela `contacts` z FK do powiatu (NOT NULL) i gminy (nullable)
  - triggery: `set_updated_at`, `set_created_by`, `validate_contact_gmina`, `contact_audit_trigger`
  - RLS: powiaty/gminy = SELECT all active; contacts = SELECT all active, INSERT/UPDATE writer, DELETE poseł

### Frontend
- `src/lib/contacts.ts` - `CONTACT_TYPE_LABELS`, `CONTACT_TYPES`
- `src/hooks/usePowiaty.ts` - słownik (staleTime: Infinity)
- `src/hooks/useGminy.ts` - słownik z opcjonalnym filtrem `powiatId`
- `src/hooks/useContacts.ts` - `useContacts(filters)`, `useCreateContact`, `useUpdateContact`, `useDeleteContact`, `useContactsCountByPowiat`, `useContactsCountByGmina`
- `src/pages/Kontakty.tsx` - strona główna
- `src/components/contacts/ContactsFilters.tsx` - Select typ/powiat/gmina + Input szukaj
- `src/components/contacts/ContactsList.tsx` - lista kart
- `src/components/contacts/ContactFormDialog.tsx` - Dialog dodawania/edycji
- `src/components/contacts/DeleteContactDialog.tsx` - potwierdzenie delete
- `src/components/contacts/DistrictSvg.tsx` - SVG choropleth okręgu (lazy-loaded), toggle powiaty/gminy
- `src/hooks/useDistrict.ts` - `useDistrictConfig()` (konfiguracja okręgu, `['district-config']`, null = brak) + `useDistrictGeo(number, level)` (geojson; `null` = brak pliku - 404 albo SPA rewrite zwracający `index.html`)

### Dane geograficzne
- `public/geo/okreg-{nr}-powiaty.geojson` (properties id, name, teryt) i `okreg-{nr}-gminy.geojson` (id, powiat_id, name, type m/w/mw, teryt) - tylko okręgi działających instancji (Workbox precache'uje `*.geojson`, więc każdy plik trafia do SW każdej instancji). Dziś: okręg 35 - 12 features (60 KB) + 61 features (160 KB).
- `scripts/districts/{1..41}.json` - definicje okręgów. Źródło: Kodeks wyborczy zał. nr 1 (Dz.U. 2026 poz. 1261); zweryfikowane: 41 okręgów dzieli wszystkie 380 powiatów z `geo-source/` dokładnie raz, okręg 35 zgodny z seedem. `35.json` ma jawne listy powiatów i gmin (id = seed migracji init, `db_name` gdy nazwa w bazie różni się od mapy, np. dwa "Świętajno"); pozostałe tylko `{ number, seat, powiaty: [{ teryt }] }` - id, nazwy (`m. X` dla miast na prawach powiatu), `is_city`, lat/lng (centroid), gminy (kolejność TERYT, "X (miasto)"/"X (gmina)" przy duplikatach) i wyróżnienie (gmina siedziby OKW, jej powiat tylko gdy miasto na prawach powiatu; siedziba poza okręgiem - np. 12, 20, 29, 30, 32 - brak wyróżnienia) wylicza skrypt. Powiat karkonoski (0206) w Kodeksie nadal jako "jeleniogórski".
- `scripts/build-okreg-geojson.mjs <nr>` (`pnpm build:geo <nr>`, `--all` = kontrola wszystkich definicji) - z `geo-source/` generuje geojson do `public/geo/` i `scripts/districts/out/okreg-{nr}-seed.sql` (podmiana słowników powiaty/gminy + `app_settings.district`; odmawia, gdy są kontakty/sprawy/wydarzenia/zgłoszenia). Wynik dla 35 bajtowo identyczny z plikami w `public/geo/`, seed SQL = dane migracji init.
- `geo-source/` - katalog .gitignored z surowymi `powiaty.json` (4.6 MB) i `gminy.json` (11.8 MB) z github.com/waszkiewiczja/GeoJSON-Polska-Województwa-Powiaty-Gminy

### Nowa instancja innego okręgu
1. `node scripts/build-okreg-geojson.mjs <nr>` (wymaga `geo-source/`), commit `public/geo/okreg-<nr>-*.geojson`.
2. Po wszystkich migracjach na pustej bazie instancji: `supabase db query --linked -f scripts/districts/out/okreg-<nr>-seed.sql`.
3. Panel admina: `site_identity.district_label`, podpis mapy na stronie głównej.

## Filtrowanie

```typescript
interface ContactsFilters {
  type?: ContactType | null;
  powiatId?: number | null;
  gminaId?: number | null;
  search?: string; // ilike na first_name || last_name || function (min. 2 znaki)
}
```

Query keys: `['contacts', type, powiatId, gminaId, search]`. Limit 200 wyników per query (paginacja w przyszłości).

## Mapa (SVG + d3-geo)

- `d3-geo` (~10 KB gzip) - `geoMercator().fitSize([800,500], geo)` + `geoPath()`
- Inline SVG z `<path>` per region, viewBox 0 0 800 500, scale 100% przez CSS
- Lazy-loaded przyciskiem "Pokaż mapę" (vendor-d3-geo chunk + GeoJSON pobrany przez fetch)
- **Toggle Powiaty (n) / Gminy (n)** - liczby ze słowników `usePowiaty()` / `useGminy()` (cache ContactsFilters); projection wspólna (oba pokrywają ten sam obszar)
- Choropleth: 5 progow (0 / 1-4 / 5-19 / 20-49 / 50+) - kolory slate-200 → blue-900
- Hover → tooltip (nazwa + liczba kontaktów), CSS pozycjonowanie względem myszy
- Klik powiatu → `filters.powiatId = id, gminaId = null`
- Klik gminy → `filters.powiatId = gmina.powiat_id, gminaId = id` (parent powiat też aktywny)
- Region `highlighted_powiat_id` / `highlighted_gmina_id` - czerwona ramka 1.5px; opis "{highlight_label} (czerwona ramka)" + " - miasto na prawach powiatu", gdy wyróżniony powiat ma `is_city`
- `aria-label` "Mapa okręgu wyborczego nr {number}"; brak konfiguracji lub pliku → "Brak mapy okręgu"
- GeoJSON cache w React Query: `['geojson', number, level]`, staleTime: Infinity (słownik) - wspólny z mapą Teren i publiczną mapą biur (`PublicOfficesMap` przy braku okręgu/pliku po prostu się nie renderuje)
- Service Worker cache .geojson (PWA offline)

## Audit log

Trigger `contacts_audit` po INSERT/UPDATE/DELETE → `log_audit('contact.create|update|delete', 'contact', id, metadata)`.

## Walidacje

- `gmina_id` (jeśli podane) musi należeć do `powiat_id` - trigger `validate_contact_gmina`
- email (jeśli podany) - Zod email check w formularzu
- imię/nazwisko - min. 2 znaki

## Historia Zmian

| Data | Zmiana |
|------|--------|
| 2026-04-25 | Inicjalizacja Fazy 2 (schema + UI + mapa Leaflet) |
| 2026-04-26 | Mapa Leaflet → SVG choropleth (d3-geo) z przelacznikiem powiaty/gminy. Realne granice GUGIK (public domain GeoJSON), Olsztyn wyróżniony, hover tooltip + click filter. Usunięte leaflet/react-leaflet. |
| 2026-05-07 | Per-user data scope dla kontaktów. Migracja `20260507000000_init_data_scope.sql`: kolumna `profiles.scope_contacts` (enum data_scope, default 'all') + helper `current_contacts_scope()` + recreate `contacts_select_authenticated` z bypassem dla Posla i filtrem `created_by = auth.uid()` dla scope='own'. Zarzadzane z `EditUserProfileDialog` w admin panelu. |
| 2026-10-18 | Masowa edycja pól wspólnych zaznaczonych kontaktów: akcja **Edytuj pola** w pasku zbiorczym (`BulkEditContactsDialog`) - zgoda na newsletter (Tak/Nie), funkcja, miejscowość, ulica, kod pocztowy (opt-in per pole, puste = wyczyść). Hook `useBulkEditContacts` (zgoda tylko dla kontaktów z e-mailem, jak w formularzu; zwraca kontakty ze zmienioną zgodą). Synchronizacja GetResponse przez `useGRBulkConsentSync` (sekwencyjnie `sync_contact`/`unsync_contact`, przerwanie gdy GR nieskonfigurowany). Bez zmian DB. |
| 2026-11-07 | Okręg instancji zamiast stałych okręgu 35: `app_settings.district` + RPC `get_public_district()` (migracja `20261107110000_district_settings.sql`), hook `src/hooks/useDistrict.ts` dla `DistrictSvg`, `VisibilityMap`, `PublicOfficesMap` ("Brak mapy okręgu" bez pliku granic). Generator `scripts/build-okreg-geojson.mjs <nr>` czyta definicje `scripts/districts/{1..41}.json` (Kodeks wyborczy zał. nr 1) i dodatkowo tworzy seed SQL słowników dla nowej instancji; wynik dla 35 bajtowo identyczny. |
| 2026-11-09 | **Przegląd UI/UX (telefon + komputer + PoliAI).** Filtry spójne ze Sprawami (wyszukiwarka „Nazwisko, funkcja...”, wysokości chipów, „Wyczyść”), rząd licznika i „Pokaż mapę” zawijany. `ContactsTable`: przyklejony `<thead>` z jednym tłem zamiast teł komórek. Lista na telefonie: akcje telefon/e-mail 44 px. `ContactDetailsDialog`: długie nazwisko zawija się, stopka jak w podglądzie sprawy (Usuń po lewej, Zamknij + Edytuj). `ContactFormDialog`: na telefonie imię/nazwisko i miejscowość/kod obok siebie, przycisk „Dodaj kontakt”/„Zapisz zmiany”. Kampanie: statusy GR `scheduled`/`sending` po polsku, ujednolicone puste stany. |
| 2026-11-10 | **Newsletter - bezpieczeństwo wysyłki** (migracja `20261110140000_newsletter_issue_ownership.sql`). Szkic wydania (`newsletter_issues`: temat, `html_web` pod `/n/<slug>`) zmienia tylko autor albo `can_manage_newsletters()` (Poseł/Administrator lub opiekun obszaru Newsletter); inny pracownik przy zapisie dostaje nowe wydanie. `getresponse-proxy` `send_newsletter`: atomowa rezerwacja `draft` → `sending` (z równoległych wysyłek przechodzi jedna, temat z zarezerwowanego wiersza), `sent` po sukcesie GR, powrót do `draft` po odrzuceniu przez GR; audyt `newsletter.send`/`send_failed` z `html_sha256`, `plain_sha256`, `list_id`, `from_field_id`. `send_test_newsletter`: bez prawa wysyłki tylko na adres własnego konta (auth), limit 10 testów/h na osobę (`audit_log` `newsletter.send_test_attempt`, wpis przed wysyłką). Wylogowanie czyści szkice z localStorage (`clearNewsletterDrafts()` w `newsletter/draft.ts`). |

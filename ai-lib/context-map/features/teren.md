# Feature: Widoczność w terenie (Faza 5)

> Mapa + tabela pokazująca aktywność biura w każdym powiecie. Alert gdy zbyt dawno bez wydarzenia.

## Cel

Daje Posłowi szybka odpowiedź: gdzie nie byłem ostatnio? Wizualizacja kolorystyczna + sortowalna tabela.

## Role

- **Poseł** - pełny wglad + edycja progu alertu
- **Pracownik / Asystent** - tylko podglad

## Routing

| Ścieżka | Strona | Guard |
|---------|--------|-------|
| `/teren` | Teren | ProtectedRoute (any active) |

## Schema (`20260426200000_init_visibility.sql`)

### app_settings
Generyczna tabela klucz/wartość dla globalnych ustawień aplikacji.

| Kolumna | Typ | Notes |
|---------|-----|-------|
| key | text PK | np. `visibility_alert_days` |
| value | jsonb | dowolny typ - number, string, obiekt |
| updated_by | uuid FK profiles | auto z auth.uid() |
| updated_at | timestamptz | trigger app_settings_set_meta |

**Seed:** `('visibility_alert_days', '90'::jsonb)`

**RLS:** SELECT all active, INSERT/UPDATE Poseł.

### powiat_visibility_stats (VIEW)
Agreguje na żywo statystyki per powiat. `with (security_invoker = true)` - RLS każdego usera dzieje się na bazowych tabelach.

| Kolumna | Typ | Wyliczenie |
|---------|-----|-----------|
| powiat_id, powiat_name, is_city, lat, lng | - | z `powiaty` |
| contacts_count | int | `count(contacts where powiat_id=p.id)` |
| events_count | int | `count(events where powiat_id=p.id and type in ('spotkanie','wyjazd') and starts_at <= now())` |
| last_event_at | timestamptz | `max(events.starts_at ...)` |
| days_since_last_event | int | `extract(day from now() - last_event_at)` lub null |

## Klasyfikacja statusu (frontend `lib/visibility.ts`)

| Status | Warunek | Kolor markera | Badge |
|--------|---------|---------------|-------|
| `green` | days_since <= threshold/2 | green-600 | "Aktywny" |
| `yellow` | threshold/2 < days_since <= threshold | yellow-500 | "Uwaga" |
| `red` | days_since > threshold OR last_event_at == null | red-600 | "Brak obecności" |
| `unknown` | threshold == 0 (disabled) | slate-400 | "Brak danych" |

## Frontend

### Pliki
- `src/lib/visibility.ts` - visibilityStatus(), VISIBILITY_HEX, lastEventLabel() (relative pl)
- `src/hooks/useAppSetting.ts` - generyczny `useAppSetting<T>(key, default)` + `useUpdateAppSetting()`
- `src/hooks/usePowiatVisibility.ts` - query view
- `src/pages/Teren.tsx`
- `src/components/visibility/VisibilityMap.tsx` (SVG d3-geo, lazy) - granice powiatów okręgu instancji
- `src/hooks/useDistrict.ts` - `useDistrictConfig()` (RPC `get_public_district`, klucz `['district-config']`) + `useDistrictGeo(number, level)` (wspólny z mapą kontaktów, szczegóły w [kontakty.md](kontakty.md#dane-geograficzne))
- `src/components/visibility/VisibilityTable.tsx` (sortowalna)
- `src/components/visibility/VisibilitySettingsDialog.tsx` (Poseł)

### UI
- Header + summary "X / 12 powiatów z obecnością w ostatnich {threshold} dniach"
- Mapa SVG - powiaty okręgu `app_settings.district.number` (`/geo/okreg-{number}-powiaty.geojson`), kolor wg statusu; `highlighted_powiat_id` z ciemną ramką 1.5px. Brak konfiguracji okręgu lub pliku granic → karta "Brak mapy okręgu" (tabela działa dalej).
- Szeroki obszar modułu (`@xl`): mapa i tabela obok siebie; węższy - jedna pod drugą.
- Tabela (własny kontener `@container/powiaty`, układ wg szerokości karty): powiat / kontakty / wydarzenia / ostatnia obecność (karta ≥ `@md`) / dni od / status; karta < 36rem → zwarte wiersze (kontakty, wydarzenia, ostatnio)
  - Sortowanie po: nazwa, contacts, events, days (default: days desc - najpilniejsze na gorze)
- VisibilitySettingsDialog (Poseł only): Input number 1-365 → upsert app_settings.visibility_alert_days

## React Query keys

| Klucz | Hook |
|-------|------|
| `['app-setting', 'visibility_alert_days']` | useAppSetting |
| `['powiat-visibility']` | usePowiatVisibility |
| `['district-config']` | useDistrictConfig |
| `['geojson', number, 'powiaty']` | useDistrictGeo |

## Historia Zmian

| Data | Zmiana |
|------|--------|
| 2026-04-26 | Inicjalizacja Fazy 5 (view + app_settings + mapa kolorow + tabela + settings) |
| 2026-11-07 | Mapa z okręgu instancji (`app_settings.district`, migracja `20261107110000_district_settings.sql`): ścieżka geojson i wyróżniony powiat z konfiguracji zamiast stałych okręgu 35; brak pliku granic → "Brak mapy okręgu". |
| 2026-11-09 | UI/UX: mapa obok tabeli na szerokim ekranie, tabela zależna od szerokości karty (panel PoliAI pokazuje tabelę zamiast kart), zwarte karty na telefonie, „1 dzień”, polskie znaki i zapis Enterem w Ustawieniach widoczności. |

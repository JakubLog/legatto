# Feature: Kalendarz (Faza 4)

> Wydarzenia biura: spotkania, wyjazdy, media, inne. Lista chronologiczna (default) + siatka miesiąca.

## Cel

Centralny rejestr wydarzen z możliwością powiązania ze sprawami i kontaktami.

## Role

- **Poseł** - pełne CRUD. Zawsze widzi wszystkie wydarzenia.
- **Pracownik** - read + write. Domyślnie widzi wszystkie; Poseł moze ograniczyć przez `profiles.scope_events='own'` (wtedy widzi tylko `created_by = self` lub `assigned_to = self`).
- **Asystent** - read-only. Ten sam mechanizm scope.

## Typy wydarzen (enum `event_type`)

`spotkanie` / `wyjazd` / `media` / `inne`

## Publikacja na stronie glownej

Wydarzenie z `is_public=true` (default `false`) trafia do sekcji "Najblizsze wydarzenia" na publicznej `/`.
Anon czyta przez SECURITY DEFINER funkcje `get_public_upcoming_events(limit)` - zwraca tylko bezpieczne pola (tytul, opis, typ, czas, lokalizacja, nazwy powiatu/gminy). `case_id`, `contact_id`, `assigned_to` NIGDY nie sa wystawiane anon.

## Routing

| Ścieżka | Strona | Guard |
|---------|--------|-------|
| `/kalendarz` | Kalendarz | ProtectedRoute (any active) |

## Key Files

### Schema
- `supabase/migrations/20260426100000_init_events.sql` - enum event_type, tabela events, triggery (validate_times, validate_gmina, audit), RLS
- `supabase/migrations/20260504100000_events_public_read.sql` - kolumna `is_public` + RPC `get_public_upcoming_events` (anon)
- `supabase/migrations/20260508300001_init_ics_sources.sql` - tabela `ics_sources`, kolumny `ics_uid`/`ics_source_id`, partial unique index, RPC `sync_ics_events`
- `supabase/migrations/20260508320000_sync_ics_events_insert_only.sql` - zmiana RPC na `ON CONFLICT DO NOTHING` + `GET DIAGNOSTICS` dla liczenia wstawień

### ICS Sync API
- `api/_lib/ics-sync.ts` - wspólny moduł: `parseIcs()` + `syncSource(sourceId, userId): SyncResult`. Źródło nieaktywne (`is_active = false`) nie jest pobierane. Pobieranie przez `safeFetch` (`api/_lib/safe-fetch.ts`: tylko `https` na porcie 443 - także po przekierowaniu, ochrona SSRF, IPv4/IPv6, przypięty lookup, limit 5 MB, timeout 20 s). Na zewnątrz (API, PoliAI/MCP) tylko stałe komunikaty błędu („Nie udało się pobrać kalendarza.”, „Niedozwolony adres kalendarza…”, „Nie udało się zapisać wydarzeń…”); kod HTTP / błąd sieci / bazy tylko w logu serwera
- `api/integracje.ts` `?op=ics_sync` (dawniej `api/sync-ics.ts`) - ręczna synchronizacja (auth JWT, Poseł + sesja aal2 przez `isAal2Session`); wielooperacyjna funkcja `?op=` (limit 12 funkcji Vercel Hobby)
- `/api/cron/sync-ics` (`api/_lib/cron/syncIcs.ts`, obsługa w `api/cron/[job].ts`) - automatyczna synchronizacja tylko aktywnych źródeł, po 4 naraz (auth `CRON_SECRET`, schedule `0 4 * * *` UTC = 06:00 Warsaw)
- Trigger `ics_sources_audit` (`ics_source.create/update/delete`; z URL logowany tylko host)
- Trigger `ics_sources_guard` (BEFORE INSERT / UPDATE OF url, migracja `20261110100000_notifications_hardening.sql`): `webcal://` → `https://`, wymagany `https://` bez innego portu niż 443, najwyżej 2000 znaków, najwyżej 20 źródeł w instancji (błąd 23514 z polskim komunikatem). Istniejące wiersze sprawdzane dopiero przy zmianie `url`

### Frontend
- `src/lib/events.ts` - labels, kolory, klasyfikator dat (today/tomorrow/this_week/...)
- `src/hooks/useEvents.ts` - useEvents(filters) + CRUD + `usePublicUpcomingEvents`
- `src/pages/Kalendarz.tsx` - pełna strona z toggle Lista/Miesiąc
- `src/components/events/EventsFilters.tsx` - Select typ/assignee + Input szukaj
- `src/components/events/EventsList.tsx` - chronologiczna z grupowaniem (Dzisiaj / Jutro / W tym tygodniu / W przyszłym tygodniu / Później / Minione)
- `src/components/events/EventsMonthGrid.tsx` - siatka 7×N, do 3 eventow per dzień + "+N more"
- `src/components/events/EventFormDialog.tsx` - pełny formularz z all_day toggle + checkbox "Pokaz publicznie", link do sprawy/kontaktu
- `src/components/events/DeleteEventDialog.tsx`
- `src/components/events/DayEventsDialog.tsx` - popup pokazywany po kliku dnia w siatce
- `src/components/public/PublicCalendarSection.tsx` - sekcja "Najblizsze wydarzenia" na HomePage (anon)

## Powiązania

- `case_id` - link do sprawy (np. spotkanie w sprawie X)
- `contact_id` - link do kontaktu (np. spotkanie z Janem K.)
- Oba opcjonalne, FK ON DELETE SET NULL

## Filtrowanie (useEvents)

```typescript
interface EventsFilters {
  type?: EventType | null;
  assignedTo?: string | null;
  search?: string; // ilike na title || description || location (min 2 znaki)
  from?: string | null; // ISO datetime
  to?: string | null;
}
```

Limit 500 wyników per query. Sort: `starts_at asc`.

## Widoki

### Lista (default)
Chronologiczna z grupowaniem. Past w odwrotnej kolejności (najnowsze pierwsze), reszta naturalnie rosnąco.

### Miesiąc (toggle)
Siatka 7×N (poniedzialek-niedziela). Pobiera dane z buforem ±7 dni dla obsługi widzianych tygodni z innych miesięcy. Klik dnia → DayEventsDialog z lista wydarzen + button "Dodaj tego dnia".

## Triggery DB

- `set_updated_at`, `set_created_by`
- `validate_event_times` - `ends_at > starts_at` gdy oba podane
- `validate_event_gmina` - gmina ⊂ powiat
- `event_audit_trigger` - emit `event.create|update|delete`

## Czas i strefy

- DB: `timestamptz` (UTC)
- UI: konwersja do lokalnej strefy (zwykle Europe/Warsaw)
- All-day: `all_day=true`, `starts_at` ustawiany na 00:00 lokalnie, `ends_at` na 23:59 lokalnie tego samego dnia

## Historia Zmian

| Data | Zmiana |
|------|--------|
| 2026-04-26 | Inicjalizacja Fazy 4 (events + lista + siatka miesiąca + linki do spraw/kontaktów) |
| 2026-05-04 | Publiczny wglad do kalendarza: kolumna `events.is_public` (default false), RPC `get_public_upcoming_events` dla anon (bezpieczne pola, bez case/contact/assigned), sekcja `PublicCalendarSection` na HomePage pod "Cztery obszary dzialania", checkbox "Pokaz publicznie" w `EventFormDialog`. |
| 2026-05-08 | ICS import: tabela `ics_sources` (name, url, last_synced_at, synced_event_count), kolumny `events.ics_uid` + `events.ics_source_id`, partial unique index `events_ics_dedup_idx`. RPC `sync_ics_events` (service_role, upsert z zachowaniem user-enriched pól: case_id/contact_id/assigned_to/is_public). Vercel Function `api/sync-ics.ts` — auth JWT, fetch ICS, parser iCalendar (UTC/DATE/TZID przez Intl). UI: `/biuro/admin/integracje/ics` + kafelek w `IntegracjeIndex`. Poseł+aal2 only. |
| 2026-05-09 | ICS cron: wspólny moduł `api/_lib/ics-sync.ts` (parser + `syncSource`). Cron endpoint `api/cron/sync-ics.ts` (auth `CRON_SECRET`, `Promise.all` po wszystkich sources). Schedule `0 4 * * *` (UTC = 06:00 Warsaw) w `vercel.json`. `api/sync-ics.ts` zrefaktoryzowany. ENV: `CRON_SECRET` na Vercel Dashboard. |
| 2026-10-18 | Audyt bezpieczeństwa: pobieranie ICS przez `api/_lib/safe-fetch.ts` (zakresy IPv6, przypięty lookup, limit 5 MB), cron i ręczna synchronizacja pomijają źródła nieaktywne, `api/sync-ics.ts` wymaga sesji aal2 (`api/_lib/jwt.ts`), trigger audytu `ics_sources_audit` (tylko host z URL), `created_by` na `ics_sources` wymuszane triggerem. Migracja `20261018210000_security_profiles_storage.sql`. |
| 2026-11-09 | UI/UX: siatka miesiąca - wąski moduł (telefon, PoliAI) ma numer dnia wyśrodkowany nad kropkami i bez przycisku „+”, wyraźniej przygaszone dni spoza miesiąca; tytuły wydarzeń w liście i w oknie dnia zawijane do 2 linii w wąskim widoku; tytuł okna dnia w dopełniaczu („12 listopada”). |
| 2026-11-10 | Przegląd SaaS (API-OTHER-5): `safeFetch` tylko `https:443`, stałe komunikaty błędów synchronizacji (szczegóły w logu), cron po 4 źródła naraz, trigger `ics_sources_guard` (https/webcal, port 443, limit 20 źródeł). Migracja `20261110100000_notifications_hardening.sql`. |

-- ePosel - okręg wyborczy instancji (jedna instancja = jeden poseł = jeden okręg).
--
-- 'district' w public.app_settings:
--   { "number": 35, "highlighted_powiat_id": 1, "highlighted_gmina_id": 1, "highlight_label": "Olsztyn" }
--   - number                - numer okręgu do Sejmu; mapy czytają public/geo/okreg-<number>-{powiaty,gminy}.geojson,
--   - highlighted_powiat_id - powiat wyróżniony czerwoną ramką (null = brak),
--   - highlighted_gmina_id  - gmina wyróżniona na poziomie gmin (null = brak),
--   - highlight_label       - opis wyróżnienia w portalu, np. "Olsztyn (czerwona ramka)".
-- Id odnoszą się do słowników public.powiaty / public.gminy; granice i słowniki generuje
-- scripts/build-okreg-geojson.mjs z definicji scripts/districts/<nr>.json.
--
-- Seed = okręg 35. Migracje są wspólne dla wszystkich instancji, ale słowniki powiaty/gminy
-- i tak seeduje dla okręgu 35 migracja 20260425100000_init_contacts_powiaty_gminy.sql (te same
-- id: powiat 1 = m. Olsztyn, gmina 1 = Olsztyn), więc ta wartość jest spójna z bazą każdej
-- świeżej instancji. Nowa instancja innego okręgu podmienia słowniki i ten klucz jednym
-- skryptem danych: scripts/districts/out/okreg-<nr>-seed.sql (wynik generatora, nie migracja).
-- `on conflict do nothing`: ponowne uruchomienie nie nadpisuje konfiguracji instancji.
--
-- Dostęp:
--   - Odczyt publiczny (anon): RPC get_public_district() - SECURITY DEFINER, zwraca wyłącznie
--     ten klucz (mapa biur na publicznej stronie głównej). Tabela app_settings pozostaje
--     niewidoczna dla anon; get_public_site_content() bez zmian.
--   - Zapis: istniejące polityki app_settings_update_posel (is_posel() and is_aal2()) +
--     audyt triggerem app_settings_audit. Panel nie edytuje okręgu - zmiana tylko razem ze
--     słownikami, skryptem danych instancji.

insert into public.app_settings (key, value)
values (
  'district',
  '{"number": 35, "highlighted_powiat_id": 1, "highlighted_gmina_id": 1, "highlight_label": "Olsztyn"}'::jsonb
)
on conflict (key) do nothing;

-- Brakujący klucz = pusty obiekt (frontend: brak skonfigurowanego okręgu, komunikat "Brak mapy okręgu").
create or replace function public.get_public_district()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.value from public.app_settings s where s.key = 'district'), '{}'::jsonb)
$$;

revoke all on function public.get_public_district() from public;
grant execute on function public.get_public_district() to anon, authenticated;

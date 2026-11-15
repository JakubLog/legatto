-- ePosel - miesięczny limit budżetu biura w bazie (jedna instancja = jeden poseł).
--
-- Do tej pory limit koszyka był stałą w kodzie (FE src/lib/expenses.ts + kopia w
-- api/_lib/poliai/budget-report.ts). Ryczałt na biuro poselskie ustala Kancelaria Sejmu
-- i zmienia się w czasie, więc limit trafia do app_settings i edytuje go Poseł z UI
-- (strona Budżet → "Ustaw limit").
--
-- Klucz 'budget_settings', wartość {"monthly_limit_pln": <liczba całkowita 1..1 000 000>}.
-- Seed 25 000 zł = dotychczasowa wartość stałej (domyślna wartość produktu); instancja
-- z innym limitem zmienia go w UI.
--
-- Dostęp:
--   - Odczyt: każdy aktywny użytkownik + aal2 (jak office_expenses / budget_reports) -
--     polityka SELECT wyłącznie dla tego klucza (wzorzec
--     app_settings_select_newsletter_defaults_writer z 20260509000001).
--   - Zapis: istniejąca app_settings_update_posel (is_posel() and is_aal2(); is_posel()
--     obejmuje administratora). Restrykcyjna app_settings_no_secret_keys blokuje tylko
--     klucze API, więc ten klucz przechodzi.
--   - Serwer (raport AI budżetu) czyta klientem service_role (bez RLS).
--   - Zmiany audytuje istniejący trigger app_settings_audit (setting.update, old/new value).

-- ============================================================================
-- 1. Wiersz budget_settings
-- ============================================================================

insert into public.app_settings (key, value)
values ('budget_settings', '{"monthly_limit_pln": 25000}'::jsonb)
on conflict (key) do nothing;

-- ============================================================================
-- 2. Walidacja kształtu (obrona w głębi - REST pozwala Posłowi zapisać dowolny JSON)
-- ============================================================================
-- CASE zamiast AND: Postgres nie gwarantuje kolejności warunków, a rzutowanie
-- nie-liczby na numeric rzuciłoby błąd zamiast naruszenia constraintu.

alter table public.app_settings drop constraint if exists app_settings_budget_settings_valid;
alter table public.app_settings add constraint app_settings_budget_settings_valid check (
  key <> 'budget_settings'
  or case
    when jsonb_typeof(value -> 'monthly_limit_pln') = 'number' then
      (value ->> 'monthly_limit_pln')::numeric between 1 and 1000000
      and (value ->> 'monthly_limit_pln')::numeric = trunc((value ->> 'monthly_limit_pln')::numeric)
    else false
  end
);

-- ============================================================================
-- 3. SELECT dla aktywnych użytkowników + aal2 - wyłącznie klucz budget_settings
-- ============================================================================

drop policy if exists "app_settings_select_budget_settings_active" on public.app_settings;
create policy "app_settings_select_budget_settings_active"
on public.app_settings for select
to authenticated
using (
  key = 'budget_settings'
  and public.is_authenticated_active()
  and public.is_aal2()
);

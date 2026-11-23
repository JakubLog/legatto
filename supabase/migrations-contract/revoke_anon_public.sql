-- compat-n-1: contract
-- contract-after: v0.1.0
-- Legatto (A6): anon traci bezpośredni dostęp do danych strony publicznej.
--
-- Strona posła jest statyczna (site/, Cloudflare Pages) i powstaje z service_site_snapshot();
-- w trybie Vercel strona główna SPA czyta tę samą migawkę przez api/public-site (service_role).
-- Bezpośrednie RPC/SELECT z kluczem anon nie są już potrzebne: odbieramy je, żeby portal
-- (na VPS tylko w tailnecie, na Vercelu publiczny) nie wystawiał API dla anonimowych klientów.
-- Zalogowani (authenticated) zachowują dostęp - panel, edytor newslettera i podgląd strony.
--
-- Etap contract (expand/contract, scripts/lint-migrations.mjs): SPA z wydań sprzed v0.1.0 czyta
-- te dane anonem, więc migracja czeka w supabase/migrations-contract/ (migrator i lint jej nie
-- czytają). W pierwszym wydaniu PO v0.1.0 skopiuj ją do supabase/migrations/ jako
-- <bieżący timestamp>_revoke_anon_public.sql (bez zmiany treści) i usuń stąd.
-- supabase/tests/run-features.sh stosuje ją po migracjach i testuje (A6).

revoke execute on function public.get_public_site_content() from anon;
revoke execute on function public.get_public_upcoming_events(int) from anon;
revoke execute on function public.get_public_office_staff(uuid) from anon;
revoke execute on function public.get_public_district() from anon;

-- Słowniki i biura: koniec SELECT dla anon (formularz publiczny bierze słowniki z migawki).
drop policy if exists offices_select_anon on public.offices;
drop policy if exists powiaty_public_read on public.powiaty;
drop policy if exists gminy_public_read on public.gminy;
drop policy if exists case_categories_public_read_system on public.case_categories;

revoke all on public.offices, public.powiaty, public.gminy, public.case_categories from anon;

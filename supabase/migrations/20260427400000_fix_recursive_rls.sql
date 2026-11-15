-- ePosel — Fix infinite recursion w RLS na profiles (error 42P17)
--
-- Problem: po zaaplikowaniu 20260427300000_security_hardening.sql logowanie
-- zwracało blad "infinite recursion detected in policy for relation profiles".
--
-- Przyczyna: SECURITY DEFINER w Supabase NIE wylacza automatycznie RLS w
-- selektach wewnatrz funkcji. Funkcje pomocnicze (is_posel, is_writer,
-- is_authenticated_active, current_office_id) robia `select from profiles`
-- wewnatrz, a poniewaz profiles ma policy ktora woła te same funkcje, mamy
-- nieskonczona petle.
--
-- Fix: dodajemy `SET row_security = off` jawnie do kazdej funkcji ktora czyta
-- z profiles. To jednoznacznie wylacza RLS w jej wnetrzu.
--
-- Plus explicit `grant execute ... to authenticated` (defaultowo PUBLIC, ale
-- explicite jest bezpieczniej dla audytu).

-- ===== current_office_id =====
create or replace function public.current_office_id()
returns uuid
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select office_id from public.profiles where id = auth.uid() and is_active = true
$$;

grant execute on function public.current_office_id() to authenticated;

-- ===== is_posel =====
create or replace function public.is_posel()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'posel' and is_active = true
  )
$$;

grant execute on function public.is_posel() to authenticated;

-- ===== is_writer =====
create or replace function public.is_writer()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('posel', 'pracownik') and is_active = true
  )
$$;

grant execute on function public.is_writer() to authenticated;

-- ===== is_authenticated_active =====
create or replace function public.is_authenticated_active()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  )
$$;

grant execute on function public.is_authenticated_active() to authenticated;

-- ePosel — Uproszczenie RLS na profiles (eliminacja recursji)
--
-- Problem: poprzednie podejscie z policy ktora wolala is_posel() / is_authenticated_active()
-- / current_office_id() powodowalo "infinite recursion detected in policy for relation
-- profiles" (error 42P17). Mimo SECURITY DEFINER + SET row_security = off, Supabase
-- nadal triggerowal RLS przy selektach z profiles wewnatrz tych funkcji.
--
-- Nowe podejscie:
-- 1. Policy `profiles_select_self` — kazdy widzi TYLKO swoj profil. Brak subquery,
--    brak rekursji, deterministyczne i bezpieczne.
-- 2. SECURITY DEFINER RPC `get_all_users_admin()` — Posel widzi wszystkie profile
--    przez ta funkcje. RLS bypass jest w funkcji (set row_security off DZIAŁA bo
--    funkcja sama nie jest wolana z policy — frontend wola RPC bezposrednio).
-- 3. SECURITY DEFINER RPC `get_office_colleagues(office_id)` — pracownik widzi
--    czlonkow tego samego biura.

-- ===== 1. Policy profiles SELECT — tylko self =====
drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_select_self_or_office_or_posel on public.profiles;
drop policy if exists profiles_select_self on public.profiles;

create policy profiles_select_self
on public.profiles for select
to authenticated
using (id = auth.uid());

-- ===== 2. RPC get_all_users_admin — pelny dostep dla Posla =====
-- Frontend (admin/Users.tsx) wola te funkcje zamiast `from('profiles').select(...)`.
-- Funkcja sprawdza is_posel sama wewnatrz (bez wywolywania funkcji is_posel zeby
-- uniknac potencjalnej recursji).
create or replace function public.get_all_users_admin()
returns table (
  id uuid,
  email text,
  full_name text,
  role public.app_role,
  is_active boolean,
  office_id uuid,
  phone text,
  avatar_url text,
  is_public boolean,
  password_set boolean,
  created_at timestamptz,
  updated_at timestamptz,
  office_name text,
  office_city text
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_is_posel boolean;
begin
  -- Sprawdzamy czy caller jest aktywnym Poslem
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'posel' and is_active = true
  ) into v_is_posel;

  if not v_is_posel then
    raise exception 'Brak uprawnien (wymagana rola: posel)' using errcode = '42501';
  end if;

  return query
    select
      p.id, p.email, p.full_name, p.role, p.is_active, p.office_id,
      p.phone, p.avatar_url, p.is_public, p.password_set,
      p.created_at, p.updated_at,
      o.name, o.city
    from public.profiles p
    left join public.offices o on o.id = p.office_id
    order by p.created_at desc;
end;
$$;

grant execute on function public.get_all_users_admin() to authenticated;

-- ===== 3. RPC get_office_colleagues — czlonkowie tego samego biura =====
-- Pracownik moze potrzebowac liste kolegow z biura (np. do future feature).
-- Posel widzi kazde biuro.
create or replace function public.get_office_colleagues(p_office_id uuid)
returns table (
  id uuid,
  full_name text,
  role public.app_role,
  phone text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_caller_office_id uuid;
  v_is_posel boolean;
begin
  select office_id, role = 'posel'
  into v_caller_office_id, v_is_posel
  from public.profiles
  where id = auth.uid() and is_active = true;

  if not v_is_posel and v_caller_office_id is distinct from p_office_id then
    raise exception 'Brak uprawnien' using errcode = '42501';
  end if;

  return query
    select p.id, p.full_name, p.role, p.phone, p.avatar_url
    from public.profiles p
    where p.office_id = p_office_id and p.is_active = true
    order by
      case p.role when 'posel' then 1 when 'pracownik' then 2 else 3 end,
      p.full_name;
end;
$$;

grant execute on function public.get_office_colleagues(uuid) to authenticated;

-- ===== 4. Cofamy zmiany w is_posel/is_writer/is_authenticated_active =====
-- Te funkcje sa nadal uzywane w policies INNYCH tabel (cases, contacts, events,
-- offices, audit_log, app_settings). Tam nie ma recursji bo nie odnosza sie do
-- profiles z policy na profiles. Wystarczy SECURITY DEFINER (juz jest).
-- Ale dodajemy SET row_security = off na wszelki wypadek.
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

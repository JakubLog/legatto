-- ePosel — Fix kolizji nazw w get_all_users_admin / get_office_colleagues
--
-- Problem: PL/pgSQL ERROR 42702 "column reference 'id' is ambiguous".
-- W funkcji RETURNS TABLE (id uuid, ...) zmienne OUT 'id' i 'role' kolidowaly
-- z kolumnami tabeli `public.profiles` w klauzuli WHERE.
--
-- Fix: aliasujemy tabele (`p.id`, `p.role`) we wszystkich queries wewnatrz
-- plpgsql, plus dodajemy `#variable_conflict use_column` zeby ewentualne
-- przyszle pomylki resolwowaly sie na kolumne (a nie zmienna).

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
#variable_conflict use_column
declare
  v_is_posel boolean;
begin
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'posel' and p.is_active = true
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
#variable_conflict use_column
declare
  v_caller_office_id uuid;
  v_is_posel boolean;
begin
  select me.office_id, me.role = 'posel'
  into v_caller_office_id, v_is_posel
  from public.profiles me
  where me.id = auth.uid() and me.is_active = true;

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

-- Fix ERROR 42702 "column reference 'id' is ambiguous" w get_all_users_admin
-- po dodaniu kolumn scope_*. OUT parametry funkcji (id/role/is_active) kolidowaly
-- z nieprefikowanymi kolumnami w klauzuli WHERE wewnatrz EXISTS — Postgres nie
-- wiedzial czy `id` to OUT parametr czy kolumna. Poprzednia migracja
-- `20260427600000_fix_admin_rpc_ambiguous` juz to raz naprawila, ale
-- `20260507120000_init_data_scope` zrobila DROP + CREATE nowej sygnatury i cofnela
-- ten fix.
--
-- Fix: alias tabeli `p` w EXISTS subquery + `#variable_conflict use_column`
-- (defensywnie - przyszle pomylki resolwuja sie na kolumne, nie OUT parametr).

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
  scope_contacts public.data_scope,
  scope_cases public.data_scope,
  scope_events public.data_scope,
  scope_interpellations public.data_scope,
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
      p.scope_contacts, p.scope_cases, p.scope_events, p.scope_interpellations,
      p.created_at, p.updated_at,
      o.name, o.city
    from public.profiles p
    left join public.offices o on o.id = p.office_id
    order by p.created_at desc;
end;
$$;

grant execute on function public.get_all_users_admin() to authenticated;

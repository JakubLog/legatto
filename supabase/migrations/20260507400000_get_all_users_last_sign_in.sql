-- Dodanie last_sign_in_at do get_all_users_admin
-- Pobieramy z auth.users przez LEFT JOIN (SECURITY DEFINER ma dostęp do auth schema).
-- DROP wymagany bo zmienia się sygnatura zwracana (nie można CREATE OR REPLACE przy zmianie OUT params).

drop function if exists public.get_all_users_admin();

create function public.get_all_users_admin()
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
  office_city text,
  last_sign_in_at timestamptz
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
      o.name, o.city,
      au.last_sign_in_at
    from public.profiles p
    left join public.offices o on o.id = p.office_id
    left join auth.users au on au.id = p.id
    order by p.created_at desc;
end;
$$;

grant execute on function public.get_all_users_admin() to authenticated;

-- ePosel — RPC get_user_admin_details (Posel-only)
--
-- Zwraca metadane konta z auth schema dla potrzeb panelu administracyjnego:
-- last_sign_in_at, email_confirmed_at, created_at konta auth, liczba aktywnych
-- sesji, liczba factor-ow MFA (total / verified).
--
-- Caller MUSI byc Poslem — sprawdzane wewnatrz funkcji.
-- Funkcja security definer + set row_security off, zeby siegnac do auth.* z
-- ograniczeniem dostepu wylacznie dla autoryzowanych Poslow.

create or replace function public.get_user_admin_details(p_user_id uuid)
returns table (
  user_id uuid,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  auth_created_at timestamptz,
  sessions_count integer,
  mfa_factors_total integer,
  mfa_factors_verified integer
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
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'posel' and p.is_active = true
  ) into v_is_posel;

  if not v_is_posel then
    raise exception 'Brak uprawnien (wymagana rola: posel)' using errcode = '42501';
  end if;

  return query
    select
      u.id as user_id,
      u.last_sign_in_at,
      u.email_confirmed_at,
      u.created_at as auth_created_at,
      coalesce((
        select count(*)::int
        from auth.sessions s
        where s.user_id = p_user_id
          and (s.not_after is null or s.not_after > now())
      ), 0) as sessions_count,
      coalesce((
        select count(*)::int
        from auth.mfa_factors f
        where f.user_id = p_user_id
      ), 0) as mfa_factors_total,
      coalesce((
        select count(*)::int
        from auth.mfa_factors f
        where f.user_id = p_user_id and f.status = 'verified'
      ), 0) as mfa_factors_verified
    from auth.users u
    where u.id = p_user_id;
end;
$$;

revoke execute on function public.get_user_admin_details(uuid) from public;
revoke execute on function public.get_user_admin_details(uuid) from anon;
grant execute on function public.get_user_admin_details(uuid) to authenticated;

comment on function public.get_user_admin_details(uuid) is
  'Posel-only — szczegoly konta auth (last_sign_in, email_confirmed, MFA counts) dla panelu admin.';

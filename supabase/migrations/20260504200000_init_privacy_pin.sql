-- Tryb prywatny: PIN do zaslony ekranu (anti-shoulder-surfing)
-- Hash PIN-u (bcrypt przez pgcrypto), 3 SECURITY DEFINER RPC, RLS hardening.
-- pgcrypto juz wlaczone w init_profiles_audit.

alter table public.profiles
  add column if not exists privacy_pin_hash text;

comment on column public.profiles.privacy_pin_hash is
  'Bcrypt hash PIN-u trybu prywatnego. NIGDY plaintext. Ustawiane wylacznie przez RPC set_my_privacy_pin.';

-- Ustawienie / zmiana PIN-u
create or replace function public.set_my_privacy_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_pin is null or length(p_pin) < 4 or length(p_pin) > 32 then
    raise exception 'PIN musi miec od 4 do 32 znakow' using errcode = '22023';
  end if;
  update public.profiles
     set privacy_pin_hash = crypt(p_pin, gen_salt('bf', 10)),
         updated_at = now()
   where id = v_user_id;
end;
$$;

revoke execute on function public.set_my_privacy_pin(text) from public;
revoke execute on function public.set_my_privacy_pin(text) from anon;
grant execute on function public.set_my_privacy_pin(text) to authenticated;

-- Weryfikacja PIN-u (server-side compare)
create or replace function public.verify_my_privacy_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  select privacy_pin_hash into v_hash
    from public.profiles
   where id = auth.uid();
  if v_hash is null then
    return false;
  end if;
  return v_hash = crypt(coalesce(p_pin, ''), v_hash);
end;
$$;

revoke execute on function public.verify_my_privacy_pin(text) from public;
revoke execute on function public.verify_my_privacy_pin(text) from anon;
grant execute on function public.verify_my_privacy_pin(text) to authenticated;

-- Wyzerowanie PIN-u (wylaczenie trybu prywatnego)
create or replace function public.clear_my_privacy_pin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  update public.profiles
     set privacy_pin_hash = null,
         updated_at = now()
   where id = auth.uid();
end;
$$;

revoke execute on function public.clear_my_privacy_pin() from public;
revoke execute on function public.clear_my_privacy_pin() from anon;
grant execute on function public.clear_my_privacy_pin() to authenticated;

-- Hardening RLS: profiles_update_self musi blokowac direct UPDATE na privacy_pin_hash
-- (zeby user nie omijal hashowania ani nie ustawial dowolnego stringa).
drop policy if exists profiles_update_self on public.profiles;

create policy profiles_update_self on public.profiles
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and email = (select profiles_1.email from public.profiles profiles_1 where profiles_1.id = auth.uid())
    and role = (select profiles_1.role from public.profiles profiles_1 where profiles_1.id = auth.uid())
    and is_active = (select profiles_1.is_active from public.profiles profiles_1 where profiles_1.id = auth.uid())
    and not (office_id is distinct from (select profiles_1.office_id from public.profiles profiles_1 where profiles_1.id = auth.uid()))
    and password_set = (select profiles_1.password_set from public.profiles profiles_1 where profiles_1.id = auth.uid())
    and created_at = (select profiles_1.created_at from public.profiles profiles_1 where profiles_1.id = auth.uid())
    and not (privacy_pin_hash is distinct from (select profiles_1.privacy_pin_hash from public.profiles profiles_1 where profiles_1.id = auth.uid()))
  );

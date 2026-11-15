-- Tryb prywatny: fix schemy pgcrypto.
--
-- Bug: `set_my_privacy_pin` i `verify_my_privacy_pin` rzucaly
--   "function gen_salt(unknown, integer) does not exist"
-- przy wywolaniu. Powod: pgcrypto siedzi w schemie `extensions` (Supabase default),
-- a obie funkcje maja `set search_path = public`, wiec nie widza `crypt`/`gen_salt`.
--
-- Fix: kwalifikujemy wywolania jawnie jako `extensions.crypt(...)` i `extensions.gen_salt(...)`.
-- Walidacja PIN-u (4-8 cyfr z poprzedniej migracji) zachowana bez zmian.

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
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN musi skladac sie z 4-8 cyfr' using errcode = '22023';
  end if;
  update public.profiles
     set privacy_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = v_user_id;
end;
$$;

revoke execute on function public.set_my_privacy_pin(text) from public;
revoke execute on function public.set_my_privacy_pin(text) from anon;
grant execute on function public.set_my_privacy_pin(text) to authenticated;

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
  return v_hash = extensions.crypt(coalesce(p_pin, ''), v_hash);
end;
$$;

revoke execute on function public.verify_my_privacy_pin(text) from public;
revoke execute on function public.verify_my_privacy_pin(text) from anon;
grant execute on function public.verify_my_privacy_pin(text) to authenticated;

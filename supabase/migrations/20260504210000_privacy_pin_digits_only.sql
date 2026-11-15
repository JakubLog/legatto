-- Tryb prywatny: zaweza walidacje set_my_privacy_pin do PIN-u numerycznego (4-8 cyfr).
-- Wczesniej akceptowal 4-32 dowolnych znakow; produkt zdecydowal o krotkim PIN-ie z numerycznym keyboardem mobile.
-- verify_my_privacy_pin / clear_my_privacy_pin bez zmian (length-agnostic).

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
     set privacy_pin_hash = crypt(p_pin, gen_salt('bf', 10)),
         updated_at = now()
   where id = v_user_id;
end;
$$;

revoke execute on function public.set_my_privacy_pin(text) from public;
revoke execute on function public.set_my_privacy_pin(text) from anon;
grant execute on function public.set_my_privacy_pin(text) to authenticated;

-- Wygasanie recznych tokenow MCP (przeglad bezpieczenstwa, API-MCP-2).
--
-- Token epm_ dziala bez drugiego skladnika, wiec musi wygasac. Od 20261107200000 kolumna
-- expires_at ma domyslnie now() + 90 dni, ale NULL (= bezterminowy w mcp_consume_token) wciaz
-- byl dopuszczalny, a uzytkownik nie mogl wybrac krotszego terminu. Teraz:
--   - create_mcp_token(p_name, p_days default 90): 1-180 dni (UI oferuje 30/90/180),
--     termin trafia do audytu mcp_token.create,
--   - aktywne tokeny bez terminu (sprzed 20261107200000, jesli jakies zostaly) dostaja now() + 90 dni
--     (nie psujemy podlaczonych klientow; UI pokazuje date), uniewaznione - expires_at = revoked_at,
--   - mcp_tokens.expires_at NOT NULL - token bez terminu nie moze juz powstac.
-- mcp_consume_token juz odrzuca tokeny z expires_at <= now() - bez zmian.

update public.mcp_tokens
   set expires_at = coalesce(revoked_at, now() + interval '90 days')
 where expires_at is null;

alter table public.mcp_tokens
  alter column expires_at set not null;

comment on column public.mcp_tokens.expires_at is
  'Koniec waznosci tokena: reczny 1-180 dni (domyslnie 90, create_mcp_token), OAuth 30 dni (/api/oauth/token).';

-- Nowy parametr z wartoscia domyslna: stara jednoargumentowa wersja musi zniknac, inaczej
-- wywolanie create_mcp_token(p_name) byloby niejednoznaczne. Wywolania z samym p_name dzialaja.
drop function if exists public.create_mcp_token(text);

create or replace function public.create_mcp_token(p_name text, p_days integer default 90)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role;
  v_token text;
  v_random text;
  v_hash text;
  v_prefix text;
  v_scopes text[];
  v_expires_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_user_id and is_active = true;
  if v_role in ('posel'::public.app_role, 'administrator'::public.app_role) then
    v_scopes := array['cases','contacts','events','interpellations','budget','audit'];
  elsif v_role = 'pracownik'::public.app_role then
    v_scopes := array['cases','contacts','events','interpellations','budget_read'];
  else
    raise exception 'Brak uprawnien (wymagana rola: posel, administrator lub pracownik)'
      using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Nazwa tokena jest wymagana' using errcode = '22023';
  end if;
  if length(p_name) > 60 then
    raise exception 'Nazwa tokena nie moze przekraczac 60 znakow' using errcode = '22023';
  end if;
  if p_days is null or p_days < 1 or p_days > 180 then
    raise exception 'Waznosc tokena: od 1 do 180 dni' using errcode = '22023';
  end if;

  v_random := translate(rtrim(encode(extensions.gen_random_bytes(36), 'base64'), '='), '+/', '-_');
  v_token := 'epm_' || v_random;
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_prefix := substr(v_random, 1, 12);
  v_expires_at := now() + make_interval(days => p_days);

  insert into public.mcp_tokens(user_id, name, token_hash, token_prefix, scopes, expires_at)
  values (v_user_id, trim(p_name), v_hash, v_prefix, v_scopes, v_expires_at);
  perform public.log_audit(
    'mcp_token.create', 'mcp_token', null,
    jsonb_build_object('name', trim(p_name), 'prefix', v_prefix, 'role', v_role, 'expires_at', v_expires_at)
  );
  return v_token;
end;
$$;

revoke all on function public.create_mcp_token(text, integer) from public, anon;
grant execute on function public.create_mcp_token(text, integer) to authenticated;

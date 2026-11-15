-- ePosel — MCP: rozszerzenie dostepu na Pracownikow
--
-- create_mcp_token teraz akceptuje Posla i Pracownika (nie Asystenta).
-- Scopy sa ustawiane automatycznie wedlug roli:
--   Posel:     cases, contacts, events, interpellations, budget, audit
--   Pracownik: cases, contacts, events  (interpelacje i budzet = READ w handlerze API)

create or replace function public.create_mcp_token(p_name text)
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
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_user_id and is_active = true;

  if v_role = 'posel'::public.app_role then
    v_scopes := array['cases','contacts','events','interpellations','budget','audit'];
  elsif v_role = 'pracownik'::public.app_role then
    v_scopes := array['cases','contacts','events','interpellations_read','budget_read'];
  else
    raise exception 'Brak uprawnien (wymagana rola: posel lub pracownik)' using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Nazwa tokena jest wymagana' using errcode = '22023';
  end if;
  if length(p_name) > 60 then
    raise exception 'Nazwa tokena nie moze przekraczac 60 znakow' using errcode = '22023';
  end if;

  v_random := translate(
    rtrim(encode(extensions.gen_random_bytes(36), 'base64'), '='),
    '+/', '-_'
  );
  v_token := 'epm_' || v_random;
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_prefix := substr(v_random, 1, 12);

  insert into public.mcp_tokens(user_id, name, token_hash, token_prefix, scopes)
  values (v_user_id, trim(p_name), v_hash, v_prefix, v_scopes);

  perform public.log_audit(
    'mcp_token.create', 'mcp_token', null,
    jsonb_build_object('name', trim(p_name), 'prefix', v_prefix, 'role', v_role)
  );

  return v_token;
end;
$$;

revoke all on function public.create_mcp_token(text) from public, anon;
grant execute on function public.create_mcp_token(text) to authenticated;

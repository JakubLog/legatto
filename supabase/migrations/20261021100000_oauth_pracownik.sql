-- ============================================================================
-- OAuth (claude.ai / aplikacja Claude) dla roli Pracownik
-- ============================================================================
-- Do tej pory OAuth App mogl utworzyc tylko Posel, choc tokeny MCP (Claude
-- Desktop) od 20260507420000_mcp_extend_roles.sql dostaja Posel i Pracownik.
-- Teraz role OAuth = role MCP: posel i pracownik. Asystent nadal bez dostepu.
--
-- Bezpieczne, bo dostep do danych w MCP jest egzekwowany per rola i zakres
-- (narzedzia z roles = POSEL_ONLY, api/_lib/access.ts odtwarza data_scope z RLS),
-- wiec Pracownik przez Claude widzi i moze tyle samo, co w aplikacji.
-- Token wydany przez /api/oauth/token dostaje zakresy wg roli wlasciciela
-- (to samo mapowanie co create_mcp_token).
--
-- Pozostale wymagania bez zmian: aktywny profil, sesja aal2 (2FA), PKCE,
-- aplikacja nalezy tylko do wlasciciela (oauth_clients.user_id = auth.uid()), audyt.
--
-- revoke_oauth_client (20261018200000_security_audit_settings_oauth.sql) i polityka
-- oauth_clients_select_self sprawdzaja tylko wlasciciela + aal2, bez roli -
-- Pracownik juz moze listowac i uniewazniac swoje aplikacje. Bez zmian.

create or replace function public.create_oauth_client(p_name text)
returns table (client_id text, client_secret text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role;
  v_client_id text;
  v_secret text;
  v_secret_hash text;
  v_secret_prefix text;
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_user_id and is_active = true;
  if v_role is null
     or v_role not in ('posel'::public.app_role, 'pracownik'::public.app_role) then
    raise exception 'Brak uprawnien (wymagana rola: posel lub pracownik)' using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Nazwa aplikacji jest wymagana' using errcode = '22023';
  end if;

  -- client_id: epc_ + 16 znakow base64url
  v_client_id := 'epc_' || translate(
    rtrim(encode(extensions.gen_random_bytes(12), 'base64'), '='), '+/', '-_'
  );

  -- client_secret: eps_ + 48 znakow base64url
  v_secret := 'eps_' || translate(
    rtrim(encode(extensions.gen_random_bytes(36), 'base64'), '='), '+/', '-_'
  );
  v_secret_hash := encode(extensions.digest(v_secret, 'sha256'), 'hex');
  v_secret_prefix := substr(v_secret, 5, 8);

  insert into public.oauth_clients(client_id, user_id, name, client_secret_hash, client_secret_prefix)
  values (v_client_id, v_user_id, trim(p_name), v_secret_hash, v_secret_prefix);

  perform public.log_audit(
    'oauth_client.create', 'oauth_client', null,
    jsonb_build_object('name', trim(p_name), 'client_id', v_client_id)
  );

  return query select v_client_id, v_secret;
end;
$$;

revoke all on function public.create_oauth_client(text) from public, anon;
grant execute on function public.create_oauth_client(text) to authenticated;

comment on table public.oauth_clients is
  'OAuth 2.0 clients dla claude.ai integracji. Generowane przez Posla lub Pracownika (wlasciciel = user_id).';

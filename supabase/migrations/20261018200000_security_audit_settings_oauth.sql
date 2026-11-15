-- ePosel - poprawki po audycie bezpieczenstwa (audit_log, sekrety app_settings,
-- OAuth/MCP, limit publicznego formularza).
--
-- 1. audit_log (MIG-03, MIG-02, EF-3):
--    - log_audit() nie jest juz wolalna przez authenticated (falszowanie wpisow,
--      np. case.note z via_mcp albo user.password_reset_sent blokujace reset hasla).
--      Wszystkie triggery i RPC wolajace log_audit() sa SECURITY DEFINER
--      (wykonuja sie jako wlasciciel funkcji), wiec dzialaja dalej - sprawdzane
--      ponizej blokiem DO.
--    - log_client_event(): waski wrapper dla frontendu (zdarzenia MFA z allow-listy).
--    - service_log_audit(): logowanie z Edge Functions / Vercel przez service_role
--      z jawnym user_id aktora (bez flagi via_mcp).
--    - app_settings_audit_trigger maskuje wartosci kluczy API; historyczne wpisy
--      z kluczami sa czyszczone.
-- 2. Sekrety w app_settings (anthropic_api_key, getresponse_api_key):
--    authenticated (takze Posel) nie widzi i nie zapisuje ich bezposrednio.
--    Zapis: set_secret_setting(), status: get_secret_settings_status().
--    service_role (Edge Functions, MCP) czyta je jak dotad.
-- 3. OAuth/MCP (MIG-04, OA-3, OA-5, OA-6):
--    - mcp_tokens.expires_at (NULL = bezterminowy, tokeny reczne z UI),
--    - mcp_consume_token odrzuca tokeny wygasle i tokeny uniewaznionej OAuth App,
--    - revoke_oauth_client uniewaznia tez tokeny wydane przez aplikacje,
--    - oauth_consume_code(): atomowe, jednorazowe zuzycie kodu autoryzacyjnego.
-- 4. public_submission_attempts + claim_public_submission_slot() (EF-2):
--    atomowy limit zgloszen z publicznego formularza (advisory lock per ip_hash).
--
-- Migracja wykonuje sie jako wlasciciel tabel (postgres), wiec polityki RLS
-- audit_log_no_update (to authenticated) nie blokuja czyszczenia historii.
-- Na audit_log nie ma triggera niemodyfikowalnosci.

-- ============================================================================
-- 1. AUDIT LOG
-- ============================================================================

-- 1a. Kontrola: kazda funkcja w public wolajaca log_audit() musi byc
--     SECURITY DEFINER - po odebraniu EXECUTE authenticated funkcja SECURITY
--     INVOKER (np. utworzona recznie poza migracjami) przestalaby dzialac.
do $$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname <> 'log_audit'
     and not p.prosecdef
     and p.prosrc ~* '(^|[^a-z0-9_])log_audit\s*\(';

  if v_bad is not null then
    raise exception 'Funkcje wolajace log_audit() bez SECURITY DEFINER: %', v_bad;
  end if;
end;
$$;

-- 1b. log_audit tylko dla wlasciciela (triggery/RPC SECURITY DEFINER) i service_role.
revoke all on function public.log_audit(text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.log_audit(text, text, uuid, jsonb) to service_role;

-- 1c. log_client_event - zdarzenia raportowane przez frontend (MFA).
--     Allow-lista akcji, encja zawsze = profil wywolujacego, z metadata
--     przechodzi tylko factor_id.
create or replace function public.log_client_event(
  p_action text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_metadata jsonb := '{}'::jsonb;
  v_factor_id text;
begin
  if v_user_id is null or not public.is_authenticated_active() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if p_action is null
     or p_action not in ('mfa.enroll', 'mfa.verify_failed', 'mfa.unenroll') then
    raise exception 'Niedozwolona akcja audytu' using errcode = '22023';
  end if;

  if p_entity_type is not null and p_entity_type <> 'profile' then
    raise exception 'Niedozwolony typ encji audytu' using errcode = '22023';
  end if;

  if p_entity_id is not null and p_entity_id <> v_user_id then
    raise exception 'Zdarzenie moze dotyczyc tylko wlasnego profilu' using errcode = '22023';
  end if;

  if p_metadata is not null then
    if jsonb_typeof(p_metadata) <> 'object' then
      raise exception 'p_metadata musi byc obiektem' using errcode = '22023';
    end if;
    v_factor_id := p_metadata ->> 'factor_id';
    if v_factor_id is not null then
      if v_factor_id !~ '^[0-9A-Za-z-]{1,64}$' then
        raise exception 'Niepoprawny factor_id' using errcode = '22023';
      end if;
      v_metadata := jsonb_build_object('factor_id', v_factor_id);
    end if;
  end if;

  perform public.log_audit(p_action, 'profile', v_user_id, v_metadata);
end;
$$;

revoke all on function public.log_client_event(text, text, uuid, jsonb) from public, anon;
grant execute on function public.log_client_event(text, text, uuid, jsonb) to authenticated;

-- 1d. service_log_audit - logowanie z kodu serwerowego (Edge Functions, Vercel
--     OAuth) przez service_role, z jawnym aktorem. Bez flagi via_mcp
--     (ta zostaje zarezerwowana dla mcp_log_audit).
create or replace function public.service_log_audit(
  p_user_id uuid,
  p_action text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid;
  v_email text;
  v_metadata jsonb := p_metadata;
begin
  if p_action is null or length(btrim(p_action)) = 0 then
    raise exception 'p_action wymagane' using errcode = '22023';
  end if;

  if p_user_id is not null then
    select id, email into v_user_id, v_email from public.profiles where id = p_user_id;
    -- Aktor bez profilu (np. juz usuniety) - FK audit_log.user_id nie pozwala
    -- go wpisac, wiec zachowujemy id w metadata.
    if v_user_id is null then
      v_metadata := coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('actor_user_id', p_user_id);
    end if;
  end if;

  insert into public.audit_log (user_id, user_email, action, entity_type, entity_id, metadata)
  values (v_user_id, v_email, p_action, p_entity_type, p_entity_id, v_metadata);
end;
$$;

revoke all on function public.service_log_audit(uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.service_log_audit(uuid, text, text, uuid, jsonb) to service_role;

-- 1e. Audit app_settings - wartosci kluczy API nie trafiaja do audit_log.
create or replace function public.app_settings_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_keys constant text[] := array['anthropic_api_key', 'getresponse_api_key'];
begin
  if tg_op = 'INSERT' then
    if new.key = any (v_secret_keys) then
      perform public.log_audit('setting.create', 'setting', null,
        jsonb_build_object('key', new.key, 'redacted', true,
          'configured', coalesce(btrim(new.value #>> '{}'), '') <> ''));
    else
      perform public.log_audit('setting.create', 'setting', null,
        jsonb_build_object('key', new.key, 'value', new.value));
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.key = any (v_secret_keys) or old.key = any (v_secret_keys) then
      perform public.log_audit('setting.update', 'setting', null,
        jsonb_build_object('key', new.key, 'redacted', true,
          'changed', old.value is distinct from new.value,
          'configured', coalesce(btrim(new.value #>> '{}'), '') <> ''));
    else
      perform public.log_audit('setting.update', 'setting', null,
        jsonb_build_object('key', new.key, 'old_value', old.value, 'new_value', new.value));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.key = any (v_secret_keys) then
      perform public.log_audit('setting.delete', 'setting', null,
        jsonb_build_object('key', old.key, 'redacted', true));
    else
      perform public.log_audit('setting.delete', 'setting', null,
        jsonb_build_object('key', old.key, 'value', old.value));
    end if;
    return old;
  end if;
  return null;
end;
$$;

revoke all on function public.app_settings_audit_trigger() from public, anon, authenticated;

-- 1f. Czyszczenie historii - stare wpisy setting.* z kluczami API w metadata.
update public.audit_log
   set metadata = (metadata - 'value' - 'old_value' - 'new_value')
                  || jsonb_build_object('redacted', true)
 where action in ('setting.create', 'setting.update', 'setting.delete')
   and metadata ->> 'key' in ('anthropic_api_key', 'getresponse_api_key')
   and (metadata ? 'value' or metadata ? 'old_value' or metadata ? 'new_value');

-- ============================================================================
-- 2. SEKRETY W APP_SETTINGS
-- ============================================================================

-- 2a. Restrykcyjna polityka (AND z istniejacymi permisywnymi): klucze API sa
--     niewidoczne i niezapisywalne dla authenticated na wszystkich operacjach.
--     Pozostale klucze zachowuja dotychczasowy dostep (Posel+aal2 SELECT/INSERT/
--     UPDATE, writer+aal2 SELECT newsletter_defaults, brak DELETE).
drop policy if exists app_settings_no_secret_keys on public.app_settings;
create policy app_settings_no_secret_keys on public.app_settings
  as restrictive
  for all
  to authenticated
  using (key not in ('anthropic_api_key', 'getresponse_api_key'))
  with check (key not in ('anthropic_api_key', 'getresponse_api_key'));

-- 2b. Zapis sekretu (Posel + aal2). Format wartosci bez zmian: jsonb string.
--     NULL / pusty string = usuniecie konfiguracji (usuniecie wiersza).
create or replace function public.set_secret_setting(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_value text := btrim(p_value);
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_posel() then
    raise exception 'Brak uprawnien (wymagana rola: posel)' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  if p_key is null or p_key not in ('anthropic_api_key', 'getresponse_api_key') then
    raise exception 'Niedozwolony klucz ustawienia' using errcode = '22023';
  end if;

  if v_value is null or v_value = '' then
    delete from public.app_settings where key = p_key;
    return;
  end if;

  if length(v_value) > 1000 then
    raise exception 'Wartosc klucza jest za dluga (max 1000 znakow)' using errcode = '22023';
  end if;

  insert into public.app_settings (key, value, updated_by, updated_at)
  values (p_key, to_jsonb(v_value), v_user_id, now())
  on conflict (key) do update
    set value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.set_secret_setting(text, text) from public, anon;
grant execute on function public.set_secret_setting(text, text) to authenticated;

-- 2c. Status sekretow (Posel + aal2) - bez wartosci, tylko koncowka.
create or replace function public.get_secret_settings_status()
returns table (key text, configured boolean, hint text)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_posel() then
    raise exception 'Brak uprawnien (wymagana rola: posel)' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  return query
  select
    k.setting_key,
    v.secret_value is not null,
    case when v.secret_value is not null then '••••' || right(v.secret_value, 4) end
  from unnest(array['anthropic_api_key', 'getresponse_api_key']) as k(setting_key)
  left join lateral (
    select nullif(btrim(s.value #>> '{}'), '') as secret_value
      from public.app_settings s
     where s.key = k.setting_key
       and jsonb_typeof(s.value) = 'string'
  ) v on true
  order by k.setting_key;
end;
$$;

revoke all on function public.get_secret_settings_status() from public, anon;
grant execute on function public.get_secret_settings_status() to authenticated;

-- ============================================================================
-- 3. OAUTH / MCP TOKENY
-- ============================================================================

-- 3a. Wygasanie tokenow. NULL = bezterminowy (tokeny reczne z UI);
--     tokeny OAuth dostaja expires_at przy wydaniu (/api/oauth/token, 30 dni).
alter table public.mcp_tokens
  add column if not exists expires_at timestamptz;

comment on column public.mcp_tokens.expires_at is
  'Koniec waznosci tokena (OAuth: 30 dni od wydania). NULL = bezterminowy (token reczny z UI).';

create index if not exists mcp_tokens_oauth_client_idx
  on public.mcp_tokens(oauth_client_id) where oauth_client_id is not null;

-- Istniejace aktywne tokeny OAuth (wydane bez terminu) wygasaja za 30 dni.
update public.mcp_tokens
   set expires_at = now() + interval '30 days'
 where oauth_client_id is not null
   and expires_at is null
   and revoked_at is null;

-- Tokeny wydane przez juz uniewaznione OAuth App - uniewazniamy.
update public.mcp_tokens m
   set revoked_at = now()
  from public.oauth_clients c
 where c.client_id = m.oauth_client_id
   and c.revoked_at is not null
   and m.revoked_at is null;

-- 3b. mcp_consume_token - sygnatura i ksztalt wyniku bez zmian; dodatkowo
--     odrzuca tokeny wygasle i tokeny uniewaznionej OAuth App.
create or replace function public.mcp_consume_token(p_token_hash text)
returns table (
  token_id uuid,
  user_id uuid,
  scopes text[],
  user_role public.app_role,
  user_full_name text,
  user_is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with t as (
    update public.mcp_tokens m
       set last_used_at = now()
     where m.token_hash = p_token_hash
       and m.revoked_at is null
       and (m.expires_at is null or m.expires_at > now())
       and (
         m.oauth_client_id is null
         or exists (
           select 1
             from public.oauth_clients c
            where c.client_id = m.oauth_client_id
              and c.revoked_at is null
         )
       )
    returning m.id, m.user_id, m.scopes
  )
  select
    t.id,
    t.user_id,
    t.scopes,
    p.role,
    p.full_name,
    p.is_active
  from t
  join public.profiles p on p.id = t.user_id;
end;
$$;

revoke all on function public.mcp_consume_token(text) from public, anon, authenticated;
grant execute on function public.mcp_consume_token(text) to service_role;

-- 3c. revoke_oauth_client - wlasciciel + aal2; uniewaznia tez tokeny aplikacji.
--     Ponowne wywolanie na uniewaznionej aplikacji dociaga ewentualne
--     pozostale aktywne tokeny (bez nowego wpisu audytu, gdy nic nie zmienia).
create or replace function public.revoke_oauth_client(p_client_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_client record;
  v_tokens integer;
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  select c.client_id, c.name, c.revoked_at
    into v_client
    from public.oauth_clients c
   where c.client_id = p_client_id and c.user_id = v_user_id;

  if not found then
    raise exception 'OAuth App nie istnieje lub nie nalezy do uzytkownika'
      using errcode = '22023';
  end if;

  if v_client.revoked_at is null then
    update public.oauth_clients c set revoked_at = now() where c.client_id = p_client_id;
  end if;

  update public.mcp_tokens m
     set revoked_at = now()
   where m.oauth_client_id = p_client_id
     and m.revoked_at is null;
  get diagnostics v_tokens = row_count;

  if v_client.revoked_at is not null and v_tokens = 0 then
    return; -- juz uniewazniona, nic do zrobienia - idempotent
  end if;

  perform public.log_audit(
    'oauth_client.revoke', 'oauth_client', null,
    jsonb_build_object('client_id', p_client_id, 'name', v_client.name, 'tokens_revoked', v_tokens)
  );
end;
$$;

revoke all on function public.revoke_oauth_client(text) from public, anon;
grant execute on function public.revoke_oauth_client(text) to authenticated;

-- 3d. oauth_consume_code - atomowe, jednorazowe zuzycie kodu (service_role).
--     Pusty wynik = invalid_grant (kod nie istnieje, inny klient, zuzyty, wygasly).
create or replace function public.oauth_consume_code(p_code text, p_client_id text)
returns setof public.oauth_codes
language sql
volatile
security definer
set search_path = public
as $$
  update public.oauth_codes oc
     set used_at = now()
   where oc.code = p_code
     and oc.client_id = p_client_id
     and oc.used_at is null
     and oc.expires_at > now()
  returning oc.*;
$$;

revoke all on function public.oauth_consume_code(text, text) from public, anon, authenticated;
grant execute on function public.oauth_consume_code(text, text) to service_role;

-- ============================================================================
-- 4. LIMIT ZGLOSZEN Z PUBLICZNEGO FORMULARZA
-- ============================================================================
create table if not exists public.public_submission_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

comment on table public.public_submission_attempts is
  'Proby zgloszen z publicznego formularza (hash IP z saltem). Tylko service_role przez claim_public_submission_slot().';

create index if not exists public_submission_attempts_ip_created_idx
  on public.public_submission_attempts(ip_hash, created_at desc);
create index if not exists public_submission_attempts_created_idx
  on public.public_submission_attempts(created_at);

alter table public.public_submission_attempts enable row level security;
-- Brak polityk: dostep wylacznie service_role / SECURITY DEFINER.
revoke all on table public.public_submission_attempts from public, anon, authenticated;

create or replace function public.claim_public_submission_slot(
  p_ip_hash text,
  p_max int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_ip_hash is null or length(p_ip_hash) = 0 or length(p_ip_hash) > 128 then
    raise exception 'p_ip_hash wymagane' using errcode = '22023';
  end if;
  if p_max is null or p_max < 1 then
    raise exception 'p_max musi byc >= 1' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'p_window_seconds musi byc w zakresie 1..86400' using errcode = '22023';
  end if;

  -- Serializacja rownoleglych prob z tego samego IP (koniec transakcji zwalnia lock).
  perform pg_advisory_xact_lock(hashtextextended('public_submission:' || p_ip_hash, 0));

  delete from public.public_submission_attempts a
   where a.created_at < now() - interval '1 day';

  select count(*)
    into v_count
    from public.public_submission_attempts a
   where a.ip_hash = p_ip_hash
     and a.created_at > now() - make_interval(secs => p_window_seconds);

  if v_count >= p_max then
    return false;
  end if;

  insert into public.public_submission_attempts (ip_hash) values (p_ip_hash);
  return true;
end;
$$;

revoke all on function public.claim_public_submission_slot(text, int, int)
  from public, anon, authenticated;
grant execute on function public.claim_public_submission_slot(text, int, int) to service_role;

-- ============================================================================
-- 5. ODWOLANIE SESJI UZYTKOWNIKA (service_role)
-- ============================================================================
-- Wolane z Edge Function admin-revoke-user-sessions klientem service_role
-- (autoryzacja Posel + aal2 po stronie funkcji). Usuwa wszystkie sesje GoTrue
-- uzytkownika; auth.refresh_tokens.session_id ma FK do auth.sessions(id)
-- ON DELETE CASCADE (tak samo auth.mfa_amr_claims). Dodatkowo usuwamy
-- ewentualne stare refresh tokeny bez session_id (sprzed tabeli sessions),
-- ktorych kaskada nie obejmie (auth.refresh_tokens.user_id jest varchar).
create or replace function public.admin_revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_sessions integer;
begin
  if p_user_id is null then
    raise exception 'p_user_id wymagane' using errcode = '22023';
  end if;

  delete from auth.sessions s where s.user_id = p_user_id;
  get diagnostics v_sessions = row_count;

  delete from auth.refresh_tokens rt
   where rt.session_id is null
     and rt.user_id = p_user_id::text;

  return v_sessions;
end;
$$;

revoke all on function public.admin_revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_user_sessions(uuid) to service_role;

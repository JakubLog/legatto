-- Audyt bezpieczenstwa 2026-11-07: dezaktywacja jako kill switch, sesje sprawdzane w RLS,
-- straznik roli/aktywnosci, is_active w politykach "wlasnych" wierszy, granty anon.
--
-- 1. profiles: nikt nie zmienia sobie roli ani is_active; ostatni aktywny Posel nie moze byc
--    zdegradowany, zdezaktywowany ani usuniety (kazda sciezka, takze service_role).
-- 2. revoke_user_access(): usuwa sesje i refresh tokeny, uniewaznia tokeny MCP, klientow
--    OAuth i niewykorzystane kody OAuth, opcjonalnie banuje usera w GoTrue. Trigger na
--    profiles.is_active: dezaktywacja = revoke + ban + audyt, reaktywacja = unban + audyt
--    (stare tokeny zostaja uniewaznione, faktory MFA zostaja).
-- 3. admin_revoke_user_sessions(): ta sama sygnatura, teraz takze tokeny MCP / klienci OAuth.
-- 4. is_aal2(): poza claimem `aal` wymaga, by sesja z JWT (`session_id`) nadal istniala
--    w auth.sessions - uniewaznienie sesji odcina PostgREST/Storage/Realtime natychmiast,
--    nie dopiero po wygasnieciu access tokena.
-- 5. is_authenticated_active() w politykach wlasnych wierszy (PoliAI, tokeny MCP, klienci
--    OAuth, profiles_update_self, avatary) i w RPC PIN-u / tokenow; PIN wymaga tez aal2.
--    mcp_consume_token nie zwraca tokenow nieaktywnych uzytkownikow.
-- 6. profiles.avatar_url: tylko publiczny URL bucketu avatars we wlasnym folderze.
-- 7. newsletter_issues.created_by: wymuszane przy INSERT, niezmienne przy UPDATE.
-- 8. mcp_tokens: domyslny termin waznosci 90 dni + backfill tokenow bez terminu.
-- 9. anon: brak grantow poza tabelami z celowa polityka anon (offices, powiaty, gminy,
--    case_categories); domyslne uprawnienia nowych tabel/sekwencji bez anon.
-- 10. PIN prywatnosci: eskalacja blokady (druga blokada w ciagu doby = 24 h).

-- ============================================================================
-- 1. Straznik roli / aktywnosci / ostatniego Posla
-- ============================================================================
create or replace function public.profiles_guard_role_active()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Wlasna rola / aktywnosc / usuniecie wlasnego profilu - zawsze z innego konta.
  if v_uid is not null and v_uid = old.id then
    if tg_op = 'DELETE'
       or new.role is distinct from old.role
       or new.is_active is distinct from old.is_active then
      raise exception 'Nie można zmienić własnej roli ani aktywności'
        using errcode = '42501';
    end if;
  end if;

  -- Ostatni aktywny Posel (rola 'posel'; administrator sie nie liczy).
  if old.role = 'posel'::public.app_role
     and old.is_active
     and (tg_op = 'DELETE'
          or new.role is distinct from old.role
          or new.is_active is distinct from true) then
    -- Serializacja rownoleglych zmian dwoch ostatnich Poslow.
    perform pg_advisory_xact_lock(hashtext('eposel.profiles_last_posel'));
    if not exists (
      select 1 from public.profiles p
       where p.id <> old.id
         and p.role = 'posel'::public.app_role
         and p.is_active
    ) then
      raise exception 'Nie można usunąć ani zdezaktywować ostatniego aktywnego Posła'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_guard_role_active() from public, anon, authenticated;

drop trigger if exists profiles_guard_role_active on public.profiles;
create trigger profiles_guard_role_active
  before update of role, is_active or delete on public.profiles
  for each row execute function public.profiles_guard_role_active();

-- ============================================================================
-- 2. Kill switch: revoke_user_access + trigger na is_active
-- ============================================================================
-- Wylacznie service_role (Edge Functions) i wnetrze triggerow/RPC SECURITY DEFINER.
-- Zwraca liczniki do metadanych audytu wywolujacego; sama nie pisze audytu.
-- Ban: banned_until = now() + 100 lat (konwencja GoTrue dla ban_duration '876000h';
-- wartosc 'infinity' nie jest bezpiecznie odczytywana przez GoTrue).
create or replace function public.revoke_user_access(
  p_user_id uuid,
  p_reason text,
  p_ban boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
set row_security = off
as $$
declare
  v_sessions integer;
  v_refresh integer;
  v_mcp integer;
  v_oauth integer;
  v_codes integer;
  v_banned boolean := false;
begin
  if p_user_id is null then
    raise exception 'p_user_id wymagane' using errcode = '22023';
  end if;

  -- Refresh tokeny najpierw (z sesja i bez), potem sesje.
  delete from auth.refresh_tokens rt where rt.user_id = p_user_id::text;
  get diagnostics v_refresh = row_count;

  delete from auth.sessions s where s.user_id = p_user_id;
  get diagnostics v_sessions = row_count;

  update public.mcp_tokens m
     set revoked_at = now()
   where m.user_id = p_user_id
     and m.revoked_at is null;
  get diagnostics v_mcp = row_count;

  update public.oauth_clients c
     set revoked_at = now()
   where c.user_id = p_user_id
     and c.revoked_at is null;
  get diagnostics v_oauth = row_count;

  delete from public.oauth_codes oc
   where oc.user_id = p_user_id
     and oc.used_at is null;
  get diagnostics v_codes = row_count;

  if coalesce(p_ban, false) then
    update auth.users u
       set banned_until = now() + interval '100 years',
           updated_at = now()
     where u.id = p_user_id;
    v_banned := found;
  end if;

  return jsonb_build_object(
    'reason', left(p_reason, 200),
    'sessions', v_sessions,
    'refresh_tokens', v_refresh,
    'mcp_tokens', v_mcp,
    'oauth_clients', v_oauth,
    'oauth_codes', v_codes,
    'banned', v_banned
  );
end;
$$;

revoke all on function public.revoke_user_access(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.revoke_user_access(uuid, text, boolean) to service_role;

create or replace function public.profiles_access_on_is_active_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
set row_security = off
as $$
declare
  v_result jsonb;
  v_unbanned boolean;
begin
  if old.is_active and not new.is_active then
    v_result := public.revoke_user_access(new.id, 'profile.deactivate', true);
    perform public.log_audit('user.access_revoked', 'profile', new.id,
      v_result || jsonb_build_object('full_name', new.full_name, 'email', new.email));
  elsif not old.is_active and new.is_active then
    update auth.users u
       set banned_until = null,
           updated_at = now()
     where u.id = new.id
       and u.banned_until is not null;
    v_unbanned := found;
    perform public.log_audit('user.access_restored', 'profile', new.id,
      jsonb_build_object('full_name', new.full_name, 'email', new.email, 'unbanned', v_unbanned));
  end if;
  return null;
end;
$$;

revoke all on function public.profiles_access_on_is_active_change() from public, anon, authenticated;

drop trigger if exists profiles_access_on_is_active_change on public.profiles;
create trigger profiles_access_on_is_active_change
  after update of is_active on public.profiles
  for each row
  when (old.is_active is distinct from new.is_active)
  execute function public.profiles_access_on_is_active_change();

-- ============================================================================
-- 3. admin_revoke_user_sessions: sygnatura i wynik (liczba sesji) bez zmian
-- ============================================================================
create or replace function public.admin_revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'p_user_id wymagane' using errcode = '22023';
  end if;

  v_result := public.revoke_user_access(p_user_id, 'admin_revoke_user_sessions', false);
  return (v_result ->> 'sessions')::integer;
end;
$$;

revoke all on function public.admin_revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_user_sessions(uuid) to service_role;

-- ============================================================================
-- 4. is_aal2(): aal2 + sesja z JWT nadal istnieje
-- ============================================================================
-- SECURITY DEFINER, bo authenticated nie czyta auth.sessions. service_role nie ma claimu
-- `aal`, wiec - jak dotad - dostaje false (sciezki service_role omijaja RLS i nie zaleza
-- od is_aal2()).
create or replace function public.is_aal2()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
     and exists (
       select 1
         from auth.sessions s
        where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
          and s.user_id = auth.uid()
          and (s.not_after is null or s.not_after > now())
     )
$$;

revoke all on function public.is_aal2() from public, anon;
grant execute on function public.is_aal2() to authenticated, service_role;

-- ============================================================================
-- 5. is_active w politykach wlasnych wierszy i RPC self-service
-- ============================================================================
drop policy if exists poliai_conversations_select_own on public.poliai_conversations;
create policy poliai_conversations_select_own on public.poliai_conversations
  for select to authenticated
  using (user_id = auth.uid() and public.is_authenticated_active() and public.is_aal2());

drop policy if exists poliai_conversations_delete_own on public.poliai_conversations;
create policy poliai_conversations_delete_own on public.poliai_conversations
  for delete to authenticated
  using (user_id = auth.uid() and public.is_authenticated_active() and public.is_aal2());

drop policy if exists poliai_attachments_select_own on public.poliai_attachments;
create policy poliai_attachments_select_own on public.poliai_attachments
  for select to authenticated
  using (user_id = auth.uid() and public.is_authenticated_active() and public.is_aal2());

drop policy if exists mcp_tokens_select_self on public.mcp_tokens;
create policy mcp_tokens_select_self on public.mcp_tokens
  for select to authenticated
  using (user_id = auth.uid() and public.is_authenticated_active() and public.is_aal2());

drop policy if exists oauth_clients_select_self on public.oauth_clients;
create policy oauth_clients_select_self on public.oauth_clients
  for select to authenticated
  using (user_id = auth.uid() and public.is_authenticated_active() and public.is_aal2());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() and public.is_authenticated_active() and is_aal2())
  with check (
    id = auth.uid()
    and public.is_authenticated_active()
    and is_aal2()
    and email                 = (select email                 from public.profiles where id = auth.uid())
    and role                  = (select role                  from public.profiles where id = auth.uid())
    and is_active             = (select is_active             from public.profiles where id = auth.uid())
    and office_id             is not distinct from (select office_id             from public.profiles where id = auth.uid())
    and password_set          = (select password_set          from public.profiles where id = auth.uid())
    and has_privacy_pin       = (select has_privacy_pin       from public.profiles where id = auth.uid())
    and created_at            = (select created_at            from public.profiles where id = auth.uid())
    and scope_contacts        = (select scope_contacts        from public.profiles where id = auth.uid())
    and scope_cases           = (select scope_cases           from public.profiles where id = auth.uid())
    and scope_events          = (select scope_events          from public.profiles where id = auth.uid())
    and scope_interpellations = (select scope_interpellations from public.profiles where id = auth.uid())
  );

drop policy if exists "avatars_upload_own" on storage.objects;
create policy "avatars_upload_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_authenticated_active()
    and public.is_aal2()
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_authenticated_active()
    and public.is_aal2()
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_authenticated_active()
    and public.is_aal2()
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_authenticated_active()
    and public.is_aal2()
  );

-- PIN prywatnosci: aktywne konto + aal2 (samo haslo nie wystarcza do ustawienia PIN-u).
create or replace function public.set_my_privacy_pin(p_pin text, p_current_pin text default null)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_hash text;
  v_locked_until timestamptz;
begin
  if v_user_id is null or not (public.is_authenticated_active() and public.is_aal2()) then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'privacy_pin_format' using errcode = '22023';
  end if;

  select privacy_pin_hash, pin_locked_until
    into v_hash, v_locked_until
    from public.profile_secrets
   where user_id = v_user_id
   for update;

  if v_hash is not null then
    if v_locked_until is not null and v_locked_until > now() then
      raise exception 'privacy_pin_locked' using errcode = '42501';
    end if;
    if p_current_pin is null or p_current_pin = '' then
      raise exception 'privacy_pin_current_required' using errcode = '22023';
    end if;
    if not public.privacy_pin_attempt(v_user_id, p_current_pin) then
      return;
    end if;
  end if;

  insert into public.profile_secrets (user_id, privacy_pin_hash, pin_failed_attempts, pin_locked_until)
  values (v_user_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), 0, null)
  on conflict (user_id) do update
    set privacy_pin_hash = excluded.privacy_pin_hash,
        pin_failed_attempts = 0,
        pin_locked_until = null;

  perform set_config('eposel.privacy_pin_rpc', 'on', true);
  update public.profiles
     set has_privacy_pin = true,
         updated_at = now()
   where id = v_user_id;
  perform set_config('eposel.privacy_pin_rpc', '', true);

  perform public.log_audit('privacy_pin.set', 'profile', v_user_id,
    jsonb_build_object('changed', v_hash is not null));
end;
$$;

create or replace function public.verify_my_privacy_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if auth.uid() is null or not (public.is_authenticated_active() and public.is_aal2()) then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  return public.privacy_pin_attempt(auth.uid(), p_pin);
end;
$$;

create or replace function public.clear_my_privacy_pin(p_current_pin text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_hash text;
  v_locked_until timestamptz;
begin
  if v_user_id is null or not (public.is_authenticated_active() and public.is_aal2()) then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select privacy_pin_hash, pin_locked_until
    into v_hash, v_locked_until
    from public.profile_secrets
   where user_id = v_user_id
   for update;

  if v_hash is null then
    raise exception 'privacy_pin_not_set' using errcode = '22023';
  end if;
  if v_locked_until is not null and v_locked_until > now() then
    raise exception 'privacy_pin_locked' using errcode = '42501';
  end if;
  if p_current_pin is null or p_current_pin = '' then
    raise exception 'privacy_pin_current_required' using errcode = '22023';
  end if;
  if not public.privacy_pin_attempt(v_user_id, p_current_pin) then
    return;
  end if;

  update public.profile_secrets
     set privacy_pin_hash = null,
         pin_failed_attempts = 0,
         pin_locked_until = null
   where user_id = v_user_id;

  perform set_config('eposel.privacy_pin_rpc', 'on', true);
  update public.profiles
     set has_privacy_pin = false,
         updated_at = now()
   where id = v_user_id;
  perform set_config('eposel.privacy_pin_rpc', '', true);

  perform public.log_audit('privacy_pin.clear', 'profile', v_user_id, null);
end;
$$;

revoke all on function public.set_my_privacy_pin(text, text) from public, anon;
revoke all on function public.verify_my_privacy_pin(text) from public, anon;
revoke all on function public.clear_my_privacy_pin(text) from public, anon;
grant execute on function public.set_my_privacy_pin(text, text) to authenticated;
grant execute on function public.verify_my_privacy_pin(text) to authenticated;
grant execute on function public.clear_my_privacy_pin(text) to authenticated;

-- 10. Eskalacja blokady PIN-u: pierwsza blokada 15 min, kolejna w ciagu doby 24 h
-- (max ~10 prob na dobe zamiast 480).
create or replace function public.privacy_pin_attempt(p_user_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_secret public.profile_secrets%rowtype;
  v_recent_locks integer;
  v_lock_minutes integer;
begin
  select * into v_secret
    from public.profile_secrets
   where user_id = p_user_id
   for update;

  if not found or v_secret.privacy_pin_hash is null then
    return false;
  end if;

  if v_secret.pin_locked_until is not null and v_secret.pin_locked_until > now() then
    raise exception 'privacy_pin_locked' using errcode = '42501';
  end if;

  if v_secret.privacy_pin_hash = extensions.crypt(coalesce(p_pin, ''), v_secret.privacy_pin_hash) then
    update public.profile_secrets
       set pin_failed_attempts = 0,
           pin_locked_until = null
     where user_id = p_user_id;
    return true;
  end if;

  if v_secret.pin_failed_attempts + 1 >= 5 then
    select count(*) into v_recent_locks
      from public.audit_log a
     where a.entity_type = 'profile'
       and a.entity_id = p_user_id
       and a.action = 'privacy_pin.locked'
       and a.created_at > now() - interval '24 hours';
    v_lock_minutes := case when v_recent_locks >= 1 then 1440 else 15 end;

    update public.profile_secrets
       set pin_failed_attempts = 0,
           pin_locked_until = now() + make_interval(mins => v_lock_minutes)
     where user_id = p_user_id;
    perform public.log_audit('privacy_pin.locked', 'profile', p_user_id,
      jsonb_build_object('locked_minutes', v_lock_minutes, 'locks_24h', v_recent_locks + 1));
  else
    update public.profile_secrets
       set pin_failed_attempts = v_secret.pin_failed_attempts + 1,
           pin_locked_until = null
     where user_id = p_user_id;
    perform public.log_audit('privacy_pin.verify_failed', 'profile', p_user_id,
      jsonb_build_object('failed_attempts', v_secret.pin_failed_attempts + 1));
  end if;

  return false;
end;
$$;

revoke all on function public.privacy_pin_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.privacy_pin_attempt(uuid, text) to service_role;

-- Tokeny MCP / klienci OAuth: zarzadzanie wlasnymi tylko z aktywnego konta.
create or replace function public.revoke_mcp_token(p_token_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_token record;
begin
  if v_user_id is null or not public.is_authenticated_active() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  select id, name, token_prefix, revoked_at
    into v_token
    from public.mcp_tokens
   where id = p_token_id and user_id = v_user_id;

  if not found then
    raise exception 'Token nie istnieje lub nie nalezy do uzytkownika'
      using errcode = '22023';
  end if;

  if v_token.revoked_at is not null then
    return;
  end if;

  update public.mcp_tokens
     set revoked_at = now()
   where id = p_token_id;

  perform public.log_audit(
    'mcp_token.revoke',
    'mcp_token',
    p_token_id,
    jsonb_build_object('name', v_token.name, 'prefix', v_token.token_prefix)
  );
end;
$$;

create or replace function public.delete_mcp_token(p_token_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_token record;
begin
  if v_user_id is null or not public.is_authenticated_active() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  select id, name, token_prefix, revoked_at
    into v_token
    from public.mcp_tokens
   where id = p_token_id and user_id = v_user_id;

  if not found then
    raise exception 'Token nie istnieje lub nie nalezy do uzytkownika'
      using errcode = '22023';
  end if;

  if v_token.revoked_at is null then
    raise exception 'Token jest aktywny - najpierw uniewaznij, potem usun'
      using errcode = '22023';
  end if;

  delete from public.mcp_tokens where id = p_token_id;

  perform public.log_audit(
    'mcp_token.delete',
    'mcp_token',
    null,
    jsonb_build_object(
      'token_id', p_token_id,
      'name', v_token.name,
      'prefix', v_token.token_prefix
    )
  );
end;
$$;

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
  if v_user_id is null or not public.is_authenticated_active() then
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

revoke all on function public.revoke_mcp_token(uuid) from public, anon;
revoke all on function public.delete_mcp_token(uuid) from public, anon;
revoke all on function public.revoke_oauth_client(text) from public, anon;
grant execute on function public.revoke_mcp_token(uuid) to authenticated;
grant execute on function public.delete_mcp_token(uuid) to authenticated;
grant execute on function public.revoke_oauth_client(text) to authenticated;

-- mcp_consume_token: token nieaktywnego uzytkownika = brak tokena (fail-closed w SQL,
-- niezaleznie od sprawdzenia user_is_active w API). Kontrakt zwracanych kolumn bez zmian.
create or replace function public.mcp_consume_token(p_token_hash text)
returns table(
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
       and exists (
         select 1
           from public.profiles ap
          where ap.id = m.user_id
            and ap.is_active
       )
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
  join public.profiles p on p.id = t.user_id
  where p.is_active;
end;
$$;

revoke all on function public.mcp_consume_token(text) from public, anon, authenticated;
grant execute on function public.mcp_consume_token(text) to service_role;

-- ============================================================================
-- 6. profiles.avatar_url: publiczny URL bucketu avatars, folder = id profilu
-- ============================================================================
-- Host: projekt Supabase (https://<ref>.supabase.co) albo lokalny stack deweloperski.
-- Ref projektu nie jest zaszyty - migracja jest wspolna dla wszystkich instancji.
alter table public.profiles drop constraint if exists profiles_avatar_url_storage_check;
alter table public.profiles
  add constraint profiles_avatar_url_storage_check check (
    avatar_url is null
    or avatar_url ~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/avatars/'
                     || id::text || '/[^/?#]+$')
    or avatar_url ~ ('^http://(127\.0\.0\.1|localhost):[0-9]+/storage/v1/object/public/avatars/'
                     || id::text || '/[^/?#]+$')
  ) not valid;
alter table public.profiles validate constraint profiles_avatar_url_storage_check;

-- ============================================================================
-- 7. newsletter_issues.created_by
-- ============================================================================
drop trigger if exists newsletter_issues_set_created_by on public.newsletter_issues;
create trigger newsletter_issues_set_created_by
  before insert on public.newsletter_issues
  for each row execute function public.set_created_by();

drop trigger if exists newsletter_issues_keep_created_by on public.newsletter_issues;
create trigger newsletter_issues_keep_created_by
  before update of created_by on public.newsletter_issues
  for each row execute function public.set_created_by();

-- ============================================================================
-- 8. mcp_tokens: domyslnie 90 dni (tokeny reczne; OAuth ustawia expires_at jawnie)
-- ============================================================================
alter table public.mcp_tokens
  alter column expires_at set default (now() + interval '90 days');

update public.mcp_tokens
   set expires_at = now() + interval '90 days'
 where expires_at is null
   and revoked_at is null;

-- ============================================================================
-- 9. Granty anon: tylko tabele z celowa polityka anon
-- ============================================================================
-- Publiczne RPC (get_public_*) sa SECURITY DEFINER i nie potrzebuja grantow tabel;
-- public-submit-case dziala na service_role.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

grant select on public.offices, public.powiaty, public.gminy, public.case_categories to anon;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

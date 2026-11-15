-- Przeglad bezpieczenstwa 2026-11-13 (pass 4, poprawki po sec3). Definicje bazowe z prod
-- (pg_get_functiondef), nie z wczesniejszych migracji.
--
-- 1. DOC-01: signing_update_document - autor (nie Posel/Administrator) zmienia dokument tylko
--    w statusach do_podpisu / do_poprawy. Od pobrania do podpisu (pobrany, podpisany) tylko
--    Posel/Administrator; kazda zmiana trafia do audytu jako from/to (dlugie teksty: dlugosc + md5).
--    Jedyna sciezka zapisu to RPC (signing_documents nie ma polityk ani grantow UPDATE).
-- 2. P0-2: revoke_user_access = jedyny punkt odciecia. Na kazdym poziomie (takze p_ban=false:
--    "Wyloguj wszedzie", reset 2FA) usuwa subskrypcje push. Usuniete dotychczasowe rozproszone
--    kasowanie push w notifications_audit_trigger.
-- 3. P0-3: limit zycia sesji bez planu Pro: is_aal2() = false dla sesji starszej niz 30 dni
--    (created_at) albo bezczynnej dluzej niz 7 dni (ostatnie odswiezenie). Sprzatanie:
--    service_purge_stale_sessions() (service_role), wolane codziennie z crona aplikacji.
-- 4. C3-04: limit komentarzy do spraw: najwyzej 20 na autora w 10 minut.
-- 5. C3-06: trash_restore / trash_restore_row - ten sam blad dla braku pozycji i braku uprawnien.
-- 6. PL3-08: trash_restoring() bez EXECUTE dla PUBLIC/anon.
-- 7. C3-02: wszystkie funkcje SECURITY DEFINER w public z pg_temp na koncu search_path (petla
--    jak w 20261110160000 §7, na koncu migracji, wiec obejmuje tez funkcje z tej migracji).
--
-- N3-01 (temat e-maila) nie dotyczy bazy: temat buduje api/_lib/notifications/templates.ts.

-- ============================================================================
-- 1. DOC-01: zamrozenie pol po pobraniu do podpisu + audyt from/to
-- ============================================================================
create or replace function public.signing_update_document(p_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_allowed constant text[] := array[
    'title', 'description', 'recipient_name', 'send_subject', 'send_text', 'case_id', 'due_date'];
  -- Pola z dlugim tekstem: w audycie tylko dlugosc i md5 (bez tresci pism).
  v_long constant text[] := array['description', 'send_text'];
  v_doc public.signing_documents%rowtype;
  v_new public.signing_documents%rowtype;
  v_key text;
  v_keys text[];
  v_old_j jsonb;
  v_new_j jsonb;
  v_changes jsonb;
begin
  perform public.signing_assert_session();
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'Nieprawidłowe zmiany' using errcode = '22023';
  end if;
  v_keys := array(select jsonb_object_keys(p_patch));
  if cardinality(v_keys) = 0 then
    raise exception 'Brak zmian' using errcode = '22023';
  end if;
  foreach v_key in array v_keys loop
    if not (v_key = any (v_allowed)) then
      raise exception 'Pola % nie można zmienić', left(v_key, 40) using errcode = '22023';
    end if;
  end loop;

  select * into v_doc from public.signing_documents where id = p_id for update;
  if not found or not public.signing_can_read(v_doc.created_by) then
    raise exception 'Nie znaleziono dokumentu' using errcode = '22023';
  end if;
  if not (public.is_posel() or (public.is_writer() and v_doc.created_by = auth.uid())) then
    raise exception 'Dokument może zmienić autor albo Poseł' using errcode = '42501';
  end if;
  if v_doc.status not in ('do_podpisu', 'pobrany', 'do_poprawy', 'podpisany') then
    raise exception 'Dokumentu % w tym statusie nie można już zmienić', v_doc.code using errcode = '55000';
  end if;
  -- Od pobrania do podpisu adresat/temat/treść są zamrożone dla autora: inaczej podpisane pismo
  -- mogłoby trafić do innego adresata niż ten, którego widział Poseł.
  if not public.is_posel() and v_doc.status not in ('do_podpisu', 'do_poprawy') then
    raise exception 'Po podpisaniu dokument może zmienić tylko Poseł lub Administrator' using errcode = '42501';
  end if;

  update public.signing_documents set
    title = case when p_patch ? 'title' then public.signing_json_title(p_patch -> 'title') else title end,
    description = case when p_patch ? 'description'
      then public.signing_json_text(p_patch -> 'description', 2000, 'Opis') else description end,
    recipient_name = case when p_patch ? 'recipient_name'
      then public.signing_json_text(p_patch -> 'recipient_name', 300, 'Adresat') else recipient_name end,
    send_subject = case when p_patch ? 'send_subject'
      then public.signing_json_text(p_patch -> 'send_subject', 255, 'Temat wysyłki') else send_subject end,
    send_text = case when p_patch ? 'send_text'
      then public.signing_json_text(p_patch -> 'send_text', 5000, 'Treść wysyłki') else send_text end,
    case_id = case when p_patch ? 'case_id' then public.signing_json_case(p_patch -> 'case_id') else case_id end,
    due_date = case when p_patch ? 'due_date' then public.signing_json_date(p_patch -> 'due_date') else due_date end
  where id = p_id
  returning * into v_new;

  v_old_j := to_jsonb(v_doc);
  v_new_j := to_jsonb(v_new);
  select coalesce(jsonb_object_agg(k,
           case when k = any (v_long) then jsonb_build_object(
                  'from_length', char_length(v_old_j ->> k), 'to_length', char_length(v_new_j ->> k),
                  'from_md5', md5(v_old_j ->> k), 'to_md5', md5(v_new_j ->> k))
                else jsonb_build_object('from', v_old_j -> k, 'to', v_new_j -> k) end), '{}'::jsonb)
    into v_changes
    from unnest(v_keys) as k
   where v_old_j -> k is distinct from v_new_j -> k;

  perform public.log_audit('signing.update', 'signing_document', p_id, jsonb_build_object(
    'code', v_doc.code, 'fields', to_jsonb(v_keys), 'status', v_doc.status, 'changes', v_changes));
end;
$$;

-- ============================================================================
-- 2. P0-2: jeden punkt odciecia
-- ============================================================================
-- Nowy kanal dostepu lub dostawy = nowa linia tutaj (security-rules: jeden punkt odciecia).
create or replace function public.revoke_user_access(p_user_id uuid, p_reason text, p_ban boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
set row_security = off
as $$
declare
  v_sessions integer;
  v_refresh integer;
  v_mcp integer;
  v_oauth integer;
  v_codes integer;
  v_push integer;
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

  -- Urzadzenia push: przejeta przegladarka nie dostaje dalszych powiadomien.
  delete from public.push_subscriptions ps where ps.user_id = p_user_id;
  get diagnostics v_push = row_count;

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
    'push_subscriptions', v_push,
    'banned', v_banned
  );
end;
$$;

revoke all on function public.revoke_user_access(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.revoke_user_access(uuid, text, boolean) to service_role;

-- notifications_audit_trigger: bez kasowania push (robi to revoke_user_access); akcja
-- user.access_revoked nie ma juz tu nic do zrobienia.
create or replace function public.notifications_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_actor_name text := public.notification_actor_name(new.user_id);
  v_changes jsonb;
  v_uid uuid;
begin
  begin
    case new.action
      when 'user.sessions_revoked' then
        perform public.notify(new.entity_id, 'security_account', jsonb_build_object(
          'event', 'sessions_revoked', 'actor', v_actor_name, 'at', new.created_at));
      when 'mfa.admin_reset' then
        perform public.notify(new.entity_id, 'security_account', jsonb_build_object(
          'event', 'mfa_reset', 'actor', v_actor_name, 'at', new.created_at));
      when 'user.profile_update' then
        v_changes := new.metadata -> 'changes';
        if new.entity_id is distinct from new.user_id
           and v_changes ?| array['role', 'scope_contacts', 'scope_cases', 'scope_events', 'scope_interpellations'] then
          perform public.notify(new.entity_id, 'security_account', jsonb_build_object(
            'event', 'access_changed', 'actor', v_actor_name, 'at', new.created_at,
            'changes', (
              select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(v_changes)
               where key in ('role', 'scope_contacts', 'scope_cases', 'scope_events', 'scope_interpellations')
            )));
        end if;
      when 'module_owners.update' then
        for v_uid in
          select public.notification_uuids(new.metadata -> 'to')
          except
          select public.notification_uuids(new.metadata -> 'from')
        loop
          if v_uid is distinct from new.user_id then
            perform public.notify(v_uid, 'responsibility', jsonb_build_object(
              'event', 'owner', 'module', new.metadata ->> 'module', 'actor', v_actor_name));
          end if;
        end loop;
      else
        null;
    end case;
  exception when others then
    raise warning 'notifications_audit_trigger: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists audit_log_notifications on public.audit_log;
create trigger audit_log_notifications
  after insert on public.audit_log
  for each row
  when (new.action = any (array['user.sessions_revoked', 'mfa.admin_reset',
                                'user.profile_update', 'module_owners.update']))
  execute function public.notifications_audit_trigger();

-- ============================================================================
-- 3. P0-3: limit zycia sesji (Free plan: brak sessions_timebox / inactivity_timeout)
-- ============================================================================
-- Jedno zrodlo wartosci dla is_aal2() i service_purge_stale_sessions(): 30 dni od zalogowania,
-- 7 dni bez odswiezenia. auth.sessions.refreshed_at to timestamp bez strefy (UTC z GoTrue).
create or replace function public.auth_session_within_limits(
  p_created_at timestamptz, p_updated_at timestamptz, p_refreshed_at timestamp)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(p_created_at > now() - interval '30 days', false)
     and coalesce(greatest(p_refreshed_at at time zone 'UTC', p_updated_at, p_created_at)
                  > now() - interval '7 days', false)
$$;

revoke all on function public.auth_session_within_limits(timestamptz, timestamptz, timestamp)
  from public, anon, authenticated;
grant execute on function public.auth_session_within_limits(timestamptz, timestamptz, timestamp) to service_role;

create or replace function public.is_aal2()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
     and exists (
       select 1
         from auth.sessions s
        where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
          and s.user_id = auth.uid()
          and (s.not_after is null or s.not_after > now())
          and public.auth_session_within_limits(s.created_at, s.updated_at, s.refreshed_at)
     )
     and exists (
       select 1
         from auth.mfa_factors f
        where f.user_id = auth.uid()
          and f.status = 'verified'
     )
$$;

create or replace function public.service_purge_stale_sessions()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
set row_security = off
as $$
declare
  v_ids uuid[];
  v_users uuid[];
  v_sessions integer := 0;
  v_refresh integer := 0;
begin
  select coalesce(array_agg(s.id), '{}'), coalesce(array_agg(distinct s.user_id), '{}')
    into v_ids, v_users
    from auth.sessions s
   where not public.auth_session_within_limits(s.created_at, s.updated_at, s.refreshed_at);

  if cardinality(v_ids) > 0 then
    -- Refresh tokeny jawnie (licznik), zanim zrobi to ON DELETE CASCADE.
    delete from auth.refresh_tokens rt where rt.session_id = any (v_ids);
    get diagnostics v_refresh = row_count;
    delete from auth.sessions s where s.id = any (v_ids);
    get diagnostics v_sessions = row_count;

    perform public.service_log_audit(null, 'session.purged_stale', null, null, jsonb_build_object(
      'sessions', v_sessions, 'refresh_tokens', v_refresh, 'user_ids', to_jsonb(v_users)));
  end if;

  return jsonb_build_object('sessions', v_sessions, 'refresh_tokens', v_refresh);
end;
$$;

revoke all on function public.service_purge_stale_sessions() from public, anon, authenticated;
grant execute on function public.service_purge_stale_sessions() to service_role;

-- ============================================================================
-- 4. C3-04: limit komentarzy do spraw (20 na autora w 10 minut)
-- ============================================================================
create index if not exists case_comments_author_created_idx
  on public.case_comments (author_id, created_at);

create or replace function public.case_comments_prepare()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  new.body := regexp_replace(coalesce(new.body, ''), '^\s+|\s+$', '', 'g');
  if auth.uid() is not null or current_user in ('authenticated', 'anon') then
    new.author_id := auth.uid();
  end if;
  new.created_at := now();

  -- Seria komentarzy z @wzmiankami wyczerpywałaby limit powiadomień odbiorcy (C3-04).
  -- Blokada doradcza serializuje równoległe wstawienia jednego autora.
  if new.author_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('case_comments_rate:' || new.author_id::text, 0));
    if (select count(*) from public.case_comments c
         where c.author_id = new.author_id
           and c.created_at > now() - interval '10 minutes') >= 20 then
      raise exception 'Za dużo komentarzy w krótkim czasie (limit: 20 na 10 minut). Spróbuj ponownie za kilka minut.'
        using errcode = '54000';
    end if;
  end if;

  new.mentions := coalesce((
    select array_agg(m.id order by m.id)
      from (select distinct u as id from unnest(coalesce(new.mentions, '{}'::uuid[])) u) m
     where m.id is distinct from new.author_id
       and public.case_visible_to(new.case_id, m.id)
  ), '{}'::uuid[]);
  return new;
end;
$$;

-- ============================================================================
-- 5. C3-06: kosz bez wyroczni istnienia
-- ============================================================================
create or replace function public.trash_restore(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_root public.trash_items%rowtype;
  v_cols text;
  v_pk_match text;
  it record;
  rl jsonb;
begin
  perform public.trash_assert_session();

  select * into v_root from public.trash_items where group_id = p_group_id and is_root for update;
  if not found or v_root.purge_after <= now() then
    raise exception 'Nie znaleziono pozycji w koszu' using errcode = 'P0002';
  end if;
  -- C3-06: brak uprawnień = ten sam błąd co brak pozycji (bez wyroczni istnienia).
  if not (public.is_posel() or v_root.deleted_by = auth.uid()) then
    raise exception 'Nie znaleziono pozycji w koszu' using errcode = 'P0002';
  end if;

  perform set_config('eposel.trash_restoring', 'on', true);

  begin
    for it in
      select t.table_name, t.row_data
        from public.trash_items t
        join public.trash_entities e on e.table_name = t.table_name
       where t.group_id = p_group_id
       order by e.restore_order, t.id
    loop
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
        from pg_attribute a
       where a.attrelid = ('public.' || quote_ident(it.table_name))::regclass
         and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
      execute format(
        'insert into public.%I (%s) overriding system value select %s from jsonb_populate_record(null::public.%I, $1)',
        it.table_name, v_cols, v_cols, it.table_name)
        using it.row_data;
    end loop;

    -- Ponowne podpięcie wierszy wyzerowanych przez `on delete set null` (tylko tych, które
    -- nadal istnieją i nie dostały w międzyczasie innej wartości).
    for rl in
      select x from public.trash_items t, jsonb_array_elements(t.relinks) x where t.group_id = p_group_id
    loop
      select string_agg(format('t.%1$I = k.%1$I', a.attname), ' and ') into v_pk_match
        from pg_index i
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
       where i.indrelid = (rl ->> 'table')::regclass and i.indisprimary;
      execute format(
        'update %s t set %I = %L from jsonb_populate_recordset(null::%s, $1) k where %s and t.%I is null',
        rl ->> 'table', rl ->> 'column', rl ->> 'value', rl ->> 'table', v_pk_match, rl ->> 'column')
        using rl -> 'keys';
    end loop;
  exception
    when foreign_key_violation then
      raise exception 'Nie można przywrócić: powiązany rekord już nie istnieje (np. sprawa nadrzędna - przywróć ją najpierw)'
        using errcode = '23503';
    when unique_violation then
      raise exception 'Nie można przywrócić: rekord o tym identyfikatorze już istnieje' using errcode = '23505';
  end;

  perform set_config('eposel.trash_restoring', '', true);

  delete from public.trash_items where group_id = p_group_id;

  perform public.log_audit('trash.restore', v_root.entity,
    case when v_root.row_key ->> 'id' ~ '^[0-9a-f-]{36}$' then (v_root.row_key ->> 'id')::uuid end,
    jsonb_build_object('title', v_root.title, 'deleted_at', v_root.deleted_at));

  return jsonb_build_object('entity', v_root.entity, 'id', v_root.row_key ->> 'id');
end;
$$;

create or replace function public.trash_restore_row(p_entity text, p_row_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_group uuid;
begin
  perform public.trash_assert_session();
  -- Tylko pozycje, które wywołujący może przywrócić; reszta = ten sam błąd co brak (C3-06).
  select t.group_id into v_group
    from public.trash_items t
   where t.is_root and t.entity = p_entity and t.row_key ->> 'id' = p_row_id
     and t.purge_after > now()
     and (public.is_posel() or t.deleted_by = auth.uid())
   order by t.deleted_at desc
   limit 1;
  if v_group is null then
    raise exception 'Nie znaleziono pozycji w koszu' using errcode = 'P0002';
  end if;
  return public.trash_restore(v_group);
end;
$$;

-- ============================================================================
-- 6. PL3-08: trash_restoring() tylko dla rol, ktore pisza do tabel kosza
-- ============================================================================
revoke execute on function public.trash_restoring() from public, anon;
grant execute on function public.trash_restoring() to authenticated, service_role;

-- ============================================================================
-- 7. C3-02: pg_temp na koncu search_path we wszystkich SECURITY DEFINER w public
-- ============================================================================
-- Zachowuje istniejaca liste schematow i pozostale ustawienia. Funkcja bez search_path
-- dostaje public, pg_temp. Funkcje rozszerzen pominiete.
do $$
declare
  r record;
  v_path text;
begin
  for r in
    select p.oid::regprocedure as sig,
           (select substr(c, length('search_path=') + 1)
              from unnest(p.proconfig) as c
             where c like 'search\_path=%') as path
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prosecdef
       and p.proowner = 'postgres'::regrole
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
       )
  loop
    if r.path ~ '(^|[ ,"])pg_temp([ ,"]|$)' then
      continue;
    end if;
    if r.path is null then
      v_path := 'public';
    else
      select string_agg(quote_ident(btrim(s, ' "')), ', ' order by o)
        into v_path
        from unnest(string_to_array(r.path, ',')) with ordinality as t(s, o)
       where btrim(s, ' "') <> '' and btrim(s, ' "') <> 'pg_temp';
    end if;
    execute format('alter function %s set search_path = %s, pg_temp', r.sig, coalesce(v_path, 'public'));
  end loop;
end;
$$;

-- ePosel - Security review: profiles, PIN prywatnosci, audyt, zalaczniki spraw, created_by
--
-- Zakres (ustalenia z przegladu bezpieczenstwa DB/RLS):
-- 1. MIG-08 / C5: hash PIN-u trybu prywatnego przeniesiony z profiles do osobnej
--    tabeli profile_secrets (RLS bez polityk, brak grantow dla klienta). Nowe RPC
--    wymagaja obecnego PIN-u przy zmianie / wylaczeniu i maja blokade po 5
--    nieudanych probach (15 min). profiles.privacy_pin_hash -> has_privacy_pin.
-- 2. MIG-01 / C6: profiles SELECT = wlasny wiersz zawsze (ekran MFA w aal1)
--    LUB aktywny uzytkownik z aal2. get_assignable_users wymaga active + aal2.
-- 3. MIG-03: triggery audytu na profiles, offices, case_attachments, ics_sources
--    (zastepuja m.in. logowanie office.create/update po stronie klienta).
-- 4. MIG-05: case_attachments i bucket case-attachments respektuja widocznosc
--    sprawy nadrzednej (data_scope); limity bucketu wymuszone.
-- 5. MIG-06: RPC admina i polityki avatars_*_posel wymagaja aal2.
-- 6. MIG-07: get_office_colleagues - poprawiona logika NULL.
-- 7. MIG-09: created_by nie do podrobienia przy INSERT i niezmienny przy UPDATE.
-- 8. Info: newsletter-assets bez publicznego listowania obiektow.

-- ============================================================================
-- 1. profile_secrets + has_privacy_pin (C5)
-- ============================================================================

create table if not exists public.profile_secrets (
  user_id             uuid primary key references public.profiles(id) on delete cascade,
  privacy_pin_hash    text,
  pin_failed_attempts integer not null default 0,
  pin_locked_until    timestamptz
);

comment on table public.profile_secrets is
  'Sekrety uzytkownika (bcrypt hash PIN-u trybu prywatnego + licznik prob). RLS bez polityk; dostep wylacznie przez RPC SECURITY DEFINER.';

alter table public.profile_secrets enable row level security;

revoke all on public.profile_secrets from public, anon, authenticated;
grant all on public.profile_secrets to service_role;

alter table public.profiles
  add column if not exists has_privacy_pin boolean not null default false;

comment on column public.profiles.has_privacy_pin is
  'Czy uzytkownik ma ustawiony PIN trybu prywatnego. Utrzymywane wylacznie przez RPC set_my_privacy_pin / clear_my_privacy_pin (hash w profile_secrets).';

-- Migracja istniejacych hashy (tylko gdy kolumna jeszcze istnieje - idempotentnie)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'privacy_pin_hash'
  ) then
    insert into public.profile_secrets (user_id, privacy_pin_hash)
      select p.id, p.privacy_pin_hash
        from public.profiles p
       where p.privacy_pin_hash is not null
    on conflict (user_id) do update
      set privacy_pin_hash = excluded.privacy_pin_hash;

    update public.profiles
       set has_privacy_pin = (privacy_pin_hash is not null)
     where has_privacy_pin is distinct from (privacy_pin_hash is not null);
  end if;
end $$;

-- Stare RPC (bez weryfikacji obecnego PIN-u) - usuwamy przed zmiana kolumny
drop function if exists public.set_my_privacy_pin(text);
drop function if exists public.clear_my_privacy_pin();

-- profiles_update_self odwoluje sie do privacy_pin_hash - odtwarzamy bez niej,
-- blokujac za to bezposrednia zmiane has_privacy_pin.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() and is_aal2())
  with check (
    id = auth.uid()
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

alter table public.profiles drop column if exists privacy_pin_hash;

-- Straznik has_privacy_pin: zmiana tylko z wnetrza RPC PIN-u (flaga transakcyjna).
-- Chroni spojnosc flagi rowniez przed profiles_update_posel.
create or replace function public.profiles_guard_has_privacy_pin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('eposel.privacy_pin_rpc', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.has_privacy_pin := false;
  else
    new.has_privacy_pin := old.has_privacy_pin;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_has_privacy_pin on public.profiles;
create trigger profiles_guard_has_privacy_pin
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_has_privacy_pin();

-- ============================================================================
-- 2. RPC PIN-u z blokada (C5)
-- ============================================================================
-- Komunikaty bledow (mapowane w UI):
--   'Unauthorized'                  - brak sesji / profilu
--   'privacy_pin_format'            - nowy PIN spoza ^[0-9]{4,8}$
--   'privacy_pin_current_required'  - PIN jest ustawiony, brak p_current_pin
--   'privacy_pin_not_set'           - clear bez ustawionego PIN-u
--   'privacy_pin_locked'            - blokada po 5 nieudanych probach (15 min)
-- Bledny p_current_pin w set/clear NIE rzuca wyjatku: wyjatek wycofalby zapis
-- licznika prob (brute-force przez clear). Funkcja zapisuje nieudana probe i
-- konczy sie bez zmian. UI weryfikuje PIN przez verify_my_privacy_pin przed
-- wywolaniem set/clear.

-- Wewnetrzny helper: weryfikacja PIN-u + licznik prob + blokada.
-- Zwraca false gdy PIN nieustawiony lub bledny; rzuca 'privacy_pin_locked'.
create or replace function public.privacy_pin_attempt(p_user_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_secret public.profile_secrets%rowtype;
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
    update public.profile_secrets
       set pin_failed_attempts = 0,
           pin_locked_until = now() + interval '15 minutes'
     where user_id = p_user_id;
    perform public.log_audit('privacy_pin.locked', 'profile', p_user_id,
      jsonb_build_object('locked_minutes', 15));
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

-- Weryfikacja PIN-u (server-side compare, liczona do blokady)
create or replace function public.verify_my_privacy_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  return public.privacy_pin_attempt(auth.uid(), p_pin);
end;
$$;

revoke all on function public.verify_my_privacy_pin(text) from public, anon;
grant execute on function public.verify_my_privacy_pin(text) to authenticated;

-- Ustawienie / zmiana PIN-u (zmiana wymaga obecnego PIN-u)
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
  if v_user_id is null or not exists (select 1 from public.profiles where id = v_user_id) then
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

revoke all on function public.set_my_privacy_pin(text, text) from public, anon;
grant execute on function public.set_my_privacy_pin(text, text) to authenticated;

-- Wylaczenie trybu prywatnego (wymaga obecnego PIN-u)
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
  if v_user_id is null then
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

revoke all on function public.clear_my_privacy_pin(text) from public, anon;
grant execute on function public.clear_my_privacy_pin(text) to authenticated;

-- ============================================================================
-- 3. profiles SELECT (MIG-01 / C6)
-- ============================================================================
-- Wlasny wiersz zawsze (AuthContext laduje profil przed MfaChallengeScreen, aal1).
-- Pozostale profile tylko dla aktywnego uzytkownika z aal2.
drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_self_or_office_or_posel on public.profiles;
drop policy if exists profiles_select_self_or_team on public.profiles;

create policy profiles_select_self_or_team on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (public.is_authenticated_active() and public.is_aal2())
  );

-- ============================================================================
-- 4. RPC profili: aal2 + poprawki logiki (MIG-01, MIG-06, MIG-07)
-- ============================================================================

create or replace function public.get_assignable_users()
returns table (
  id uuid,
  full_name text,
  role public.app_role,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
#variable_conflict use_column
begin
  if not (public.is_authenticated_active() and public.is_aal2()) then
    raise exception 'Brak uprawnien' using errcode = '42501';
  end if;

  return query
    select p.id, p.full_name, p.role, p.avatar_url
    from public.profiles p
    where p.is_active = true
    order by p.full_name;
end;
$$;

revoke all on function public.get_assignable_users() from public, anon;
grant execute on function public.get_assignable_users() to authenticated;

create or replace function public.get_all_users_admin()
returns table (
  id uuid,
  email text,
  full_name text,
  role public.app_role,
  is_active boolean,
  office_id uuid,
  phone text,
  avatar_url text,
  is_public boolean,
  password_set boolean,
  scope_contacts public.data_scope,
  scope_cases public.data_scope,
  scope_events public.data_scope,
  scope_interpellations public.data_scope,
  created_at timestamptz,
  updated_at timestamptz,
  office_name text,
  office_city text,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
#variable_conflict use_column
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
  if not public.is_aal2() then
    raise exception 'Wymagane uwierzytelnienie dwuskladnikowe (aal2)' using errcode = '42501';
  end if;

  return query
    select
      p.id, p.email, p.full_name, p.role, p.is_active, p.office_id,
      p.phone, p.avatar_url, p.is_public, p.password_set,
      p.scope_contacts, p.scope_cases, p.scope_events, p.scope_interpellations,
      p.created_at, p.updated_at,
      o.name, o.city,
      au.last_sign_in_at
    from public.profiles p
    left join public.offices o on o.id = p.office_id
    left join auth.users au on au.id = p.id
    order by p.created_at desc;
end;
$$;

revoke all on function public.get_all_users_admin() from public, anon;
grant execute on function public.get_all_users_admin() to authenticated;

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
  if not public.is_aal2() then
    raise exception 'Wymagane uwierzytelnienie dwuskladnikowe (aal2)' using errcode = '42501';
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

revoke all on function public.get_user_admin_details(uuid) from public, anon;
grant execute on function public.get_user_admin_details(uuid) to authenticated;

-- MIG-07: brak aktywnego profilu => NOT FOUND => odmowa (wczesniej NULL przepuszczal)
create or replace function public.get_office_colleagues(p_office_id uuid)
returns table (
  id uuid,
  full_name text,
  role public.app_role,
  phone text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
#variable_conflict use_column
declare
  v_caller_office_id uuid;
  v_is_posel boolean;
begin
  select me.office_id, me.role = 'posel'
  into v_caller_office_id, v_is_posel
  from public.profiles me
  where me.id = auth.uid() and me.is_active = true;

  if not found
     or not public.is_aal2()
     or (not coalesce(v_is_posel, false) and v_caller_office_id is distinct from p_office_id) then
    raise exception 'Brak uprawnien' using errcode = '42501';
  end if;

  return query
    select p.id, p.full_name, p.role, p.phone, p.avatar_url
    from public.profiles p
    where p.office_id = p_office_id and p.is_active = true
    order by
      case p.role when 'posel' then 1 when 'pracownik' then 2 else 3 end,
      p.full_name;
end;
$$;

revoke all on function public.get_office_colleagues(uuid) from public, anon;
grant execute on function public.get_office_colleagues(uuid) to authenticated;

-- ============================================================================
-- 5. Triggery audytu (MIG-03)
-- ============================================================================
-- Wszystkie trigger functions SECURITY DEFINER (log_audit nie jest wykonywalne
-- przez authenticated). Wpis zawiera aktora z auth.uid() (NULL dla service_role).

-- Helper: roznica wybranych kluczy dwoch rekordow jsonb -> {klucz: {from, to}}
create or replace function public.audit_jsonb_diff(p_old jsonb, p_new jsonb, p_keys text[])
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(k, jsonb_build_object('from', p_old -> k, 'to', p_new -> k)),
    '{}'::jsonb
  )
  from unnest(p_keys) as k
  where (p_old -> k) is distinct from (p_new -> k)
$$;

revoke all on function public.audit_jsonb_diff(jsonb, jsonb, text[]) from public, anon, authenticated;

-- ----- profiles (PIN nigdy nie trafia do audytu) -----
create or replace function public.profile_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('user.profile_create', 'profile', new.id,
      jsonb_build_object(
        'email', new.email,
        'full_name', new.full_name,
        'role', new.role,
        'office_id', new.office_id,
        'is_active', new.is_active
      ));
    return new;
  elsif tg_op = 'UPDATE' then
    v_changes := public.audit_jsonb_diff(
      to_jsonb(old), to_jsonb(new),
      array[
        'role', 'is_active', 'office_id',
        'scope_contacts', 'scope_cases', 'scope_events', 'scope_interpellations',
        'is_public', 'full_name'
      ]
    );
    if v_changes <> '{}'::jsonb then
      perform public.log_audit('user.profile_update', 'profile', new.id,
        jsonb_build_object('full_name', new.full_name, 'changes', v_changes));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_audit('user.profile_delete', 'profile', old.id,
      jsonb_build_object('email', old.email, 'full_name', old.full_name, 'role', old.role));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function public.profile_audit_trigger();

-- ----- offices (zastepuje logowanie office.create/update z klienta) -----
create or replace function public.office_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('office.create', 'office', new.id,
      jsonb_build_object('name', new.name, 'city', new.city));
    return new;
  elsif tg_op = 'UPDATE' then
    v_changes := public.audit_jsonb_diff(
      to_jsonb(old), to_jsonb(new),
      array['name', 'city', 'address', 'phone', 'email', 'is_main', 'is_active']
    );
    if v_changes <> '{}'::jsonb then
      perform public.log_audit('office.update', 'office', new.id,
        jsonb_build_object('name', new.name, 'changes', v_changes));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_audit('office.delete', 'office', old.id,
      jsonb_build_object('name', old.name, 'city', old.city));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists offices_audit on public.offices;
create trigger offices_audit
  after insert or update or delete on public.offices
  for each row execute function public.office_audit_trigger();

-- ----- case_attachments -----
create or replace function public.case_attachment_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('case_attachment.create', 'case_attachment', new.id,
      jsonb_build_object(
        'case_id', new.case_id,
        'filename', new.filename,
        'mime_type', new.mime_type,
        'size_bytes', new.size_bytes
      ));
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.log_audit('case_attachment.update', 'case_attachment', new.id,
      jsonb_build_object('case_id', new.case_id, 'filename', new.filename));
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_audit('case_attachment.delete', 'case_attachment', old.id,
      jsonb_build_object('case_id', old.case_id, 'filename', old.filename));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists case_attachments_audit on public.case_attachments;
create trigger case_attachments_audit
  after insert or update or delete on public.case_attachments
  for each row execute function public.case_attachment_audit_trigger();

-- ----- ics_sources (URL kalendarza bywa sekretem: logujemy tylko host) -----
create or replace function public.ics_url_host(p_url text)
returns text
language sql
immutable
set search_path = public
as $$
  select substring(p_url from '^[A-Za-z][A-Za-z0-9+.-]*://(?:[^/?#@]*@)?([^/?#:]+)')
$$;

revoke all on function public.ics_url_host(text) from public, anon, authenticated;

create or replace function public.ics_source_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('ics_source.create', 'ics_source', new.id,
      jsonb_build_object(
        'name', new.name,
        'url_host', public.ics_url_host(new.url),
        'is_active', new.is_active
      ));
    return new;
  elsif tg_op = 'UPDATE' then
    -- Synchronizacja (last_synced_at / synced_event_count) nie jest logowana.
    v_changes := public.audit_jsonb_diff(
      to_jsonb(old), to_jsonb(new),
      array['name', 'is_active']
    );
    if old.url is distinct from new.url then
      v_changes := v_changes || jsonb_build_object('url_host', jsonb_build_object(
        'from', public.ics_url_host(old.url),
        'to', public.ics_url_host(new.url)
      ));
    end if;
    if v_changes <> '{}'::jsonb then
      perform public.log_audit('ics_source.update', 'ics_source', new.id,
        jsonb_build_object('name', new.name, 'changes', v_changes));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_audit('ics_source.delete', 'ics_source', old.id,
      jsonb_build_object('name', old.name, 'url_host', public.ics_url_host(old.url)));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists ics_sources_audit on public.ics_sources;
create trigger ics_sources_audit
  after insert or update or delete on public.ics_sources
  for each row execute function public.ics_source_audit_trigger();

-- ============================================================================
-- 6. case_attachments + bucket case-attachments (MIG-05)
-- ============================================================================
-- Konwencja sciezki (src/hooks/useCaseAttachments.ts): '{case_id}/{ts}-{rand}.{ext}'.
-- Flow: upload do storage (INSERT) -> insert wiersza case_attachments ->
-- signed URL (SELECT). Usuwanie: delete wiersza -> storage.remove (SELECT+DELETE, Posel).

-- Limity bucketu wymuszone niezaleznie od tego, czy bucket istnial wczesniej
update storage.buckets
   set public = false,
       file_size_limit = 10485760,
       allowed_mime_types = array[
         'application/pdf',
         'image/jpeg',
         'image/png',
         'image/webp',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'text/plain'
       ]
 where id = 'case-attachments';

-- SELECT wiersza: tylko gdy sprawa nadrzedna jest widoczna (RLS cases = data_scope)
drop policy if exists ca_select on public.case_attachments;
create policy ca_select on public.case_attachments
  for select to authenticated
  using (
    is_authenticated_active()
    and is_aal2()
    and exists (select 1 from public.cases c where c.id = case_attachments.case_id)
  );

-- INSERT: writer + widoczna sprawa + storage_path w folderze tej sprawy
-- (inaczej wiersz we wlasnej sprawie moglby wskazywac plik z cudzej).
drop policy if exists ca_insert on public.case_attachments;
create policy ca_insert on public.case_attachments
  for insert to authenticated
  with check (
    is_writer()
    and is_aal2()
    and split_part(case_attachments.storage_path, '/', 1) = case_attachments.case_id::text
    and exists (select 1 from public.cases c where c.id = case_attachments.case_id)
  );

-- Storage INSERT: writer + pierwszy segment sciezki = id widocznej sprawy
drop policy if exists "case_attachments_upload" on storage.objects;
create policy "case_attachments_upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'case-attachments'
    and public.is_writer()
    and public.is_aal2()
    and exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(objects.name))[1]
    )
  );

-- Storage SELECT: istnieje widoczny (RLS ca_select) wiersz case_attachments
-- wskazujacy ten obiekt. Posel (widzi wszystkie sprawy) dodatkowo bez wiersza -
-- potrzebne do storage.remove po usunieciu rekordu.
drop policy if exists "case_attachments_read" on storage.objects;
create policy "case_attachments_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'case-attachments'
    and public.is_authenticated_active()
    and public.is_aal2()
    and (
      exists (
        select 1 from public.case_attachments ca
        where ca.storage_path = objects.name
          and ca.case_id::text = (storage.foldername(objects.name))[1]
      )
      or public.is_posel()
    )
  );

-- ============================================================================
-- 7. Avatary - polityki Posla wymagaja aal2 (MIG-06)
-- ============================================================================
drop policy if exists "avatars_upload_posel" on storage.objects;
create policy "avatars_upload_posel"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and public.is_posel() and public.is_aal2());

drop policy if exists "avatars_update_posel" on storage.objects;
create policy "avatars_update_posel"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and public.is_posel() and public.is_aal2())
  with check (bucket_id = 'avatars' and public.is_posel() and public.is_aal2());

drop policy if exists "avatars_delete_posel" on storage.objects;
create policy "avatars_delete_posel"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and public.is_posel() and public.is_aal2());

-- ============================================================================
-- 8. newsletter-assets - bez publicznego listowania (Info)
-- ============================================================================
-- Decyzja: bucket jest publiczny (public = true), wiec URL-e
-- /storage/v1/object/public/newsletter-assets/... (getPublicUrl, klienci poczty)
-- dzialaja bez polityki SELECT - tak jak avatars po 20260504000000.
-- Polityka "to public" pozwalala anonimowo listowac wszystkie obiekty (foldery =
-- UUID uzytkownikow), wiec ja usuwamy - tylko gdy bucket faktycznie jest publiczny.
-- W zamian SELECT dla authenticated w zakresie polityki DELETE (storage.remove
-- wymaga SELECT): wlasny folder writera lub Posel, z aal2.
do $$
begin
  if exists (select 1 from storage.buckets where id = 'newsletter-assets' and public = true) then
    drop policy if exists "newsletter_assets_public_read" on storage.objects;
  end if;
end $$;

drop policy if exists "newsletter_assets_select_own_or_posel" on storage.objects;
create policy "newsletter_assets_select_own_or_posel"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'newsletter-assets'
    and public.is_aal2()
    and (
      ((storage.foldername(objects.name))[1] = auth.uid()::text and public.is_writer())
      or public.is_posel()
    )
  );

-- ============================================================================
-- 9. created_by - nie do podrobienia (MIG-09)
-- ============================================================================
-- INSERT: zawsze auth.uid() dla sesji uzytkownika; service_role (auth.uid() NULL:
-- MCP, Edge Functions, sync_ics_events) zachowuje przekazana wartosc.
-- UPDATE: created_by niezmienne dla sesji uzytkownika. Wyjatek: zagniezdzone
-- triggery (pg_trigger_depth() > 1), m.in. akcja FK ON DELETE SET NULL przy
-- usuwaniu profilu - inaczej usuniecie uzytkownika konczyloby sie bledem FK.
create or replace function public.set_created_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  elsif tg_op = 'UPDATE' then
    if auth.uid() is not null and pg_trigger_depth() <= 1 then
      new.created_by := old.created_by;
    end if;
  end if;
  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'contacts', 'cases', 'events', 'interpellations', 'office_expenses',
    'case_attachments', 'ics_sources', 'case_categories', 'expense_categories'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_set_created_by', v_table);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.set_created_by()',
      v_table || '_set_created_by', v_table
    );
    execute format('drop trigger if exists %I on public.%I', v_table || '_keep_created_by', v_table);
    execute format(
      'create trigger %I before update of created_by on public.%I for each row execute function public.set_created_by()',
      v_table || '_keep_created_by', v_table
    );
  end loop;
end $$;

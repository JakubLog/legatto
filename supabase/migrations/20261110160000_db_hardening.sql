-- Przeglad bezpieczenstwa 2026-11-10 (sec3), baza danych: DBF-2, DBF-4 (pochodzenie
-- zgloszenia), DBP-4, DBF-5, DBF-7/DBP-6, DBP-3, DBP-5, DBF-9 (pg_temp).
-- Definicje bazowe pobrane z bazy z kompletem migracji (pg_get_functiondef).
--
-- 1. profile_audit_trigger: zmiana email / phone / avatar_url trafia do audytu (from/to).
--    profiles.email jest odbiorca powiadomien i migawka audit_log.user_email.
-- 2. cases: source / consent_* / submission_* ustawia tylko serwer (service_role,
--    public-submit-case). Klient (authenticated/anon) wstawia wylacznie source='internal'
--    bez zgod i metadanych zgloszenia, a w UPDATE nie zmienia tych kolumn.
-- 3. current_*_scope(): brak / nieaktywny profil = 'own' (fail closed, bylo 'all').
-- 4. Granty tabel: bez TRUNCATE / REFERENCES / TRIGGER dla anon i authenticated (TRUNCATE
--    omija RLS i triggery audytu), takze dla przyszlych tabel; audit_log bez
--    INSERT/UPDATE/DELETE, oauth_codes bez zadnych grantow dla authenticated.
-- 5. profiles: full_name 2-120 znakow bez znakow sterujacych, phone tylko cyfry i
--    + ( ) . / - spacja (5-25), pusty telefon = null. Sprawdzane triggerem tylko przy
--    zmianie wartosci (dane produkcyjne nieznane - stary wiersz nie blokuje np. dezaktywacji).
-- 6. profiles.avatar_url ustawiany przez klienta musi wskazywac bucket avatars tej
--    instancji: host z claimu iss JWT (https://<ref>.supabase.co/auth/v1, podpisany przez
--    GoTrue tej instancji), sciezka avatars/<id profilu>/.
-- 7. Funkcje SECURITY DEFINER w public: pg_temp na koncu search_path.
--
-- Poza ta migracja (nie da sie migracja): schemat net i funkcje net.* naleza do
-- supabase_admin, granty dla anon/authenticated nadal supabase_admin - rola postgres nie moze
-- ich odebrac (REVOKE konczy sie "no privileges could be revoked"). Opis w
-- ai-lib/context-map/infrastructure/database.md.

-- ============================================================================
-- 1. Audyt zmiany email / phone / avatar_url profilu
-- ============================================================================
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
        'is_public', 'full_name', 'email', 'phone', 'avatar_url'
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

-- ============================================================================
-- 2. cases: pochodzenie zgloszenia i zgody tylko od serwera
-- ============================================================================
-- SECURITY INVOKER: current_user = rola wywolujacego (authenticated / anon / service_role);
-- ten sam wzorzec co newsletter_issues_guard_publish. service_role (public-submit-case,
-- MCP, api/*) i postgres (migracje, funkcje SECURITY DEFINER) przechodza bez zmian.
create or replace function public.cases_guard_provenance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.source is distinct from 'internal'::public.case_source
         or new.consent_newsletter is true
         or new.consent_contacts_db is true
         or new.submission_ip_hash is not null
         or new.submission_user_agent is not null then
        raise exception 'Zgloszenie z formularza publicznego i zgody zapisuje tylko serwer'
          using errcode = '42501';
      end if;
    elsif new.source is distinct from old.source
       or new.consent_newsletter is distinct from old.consent_newsletter
       or new.consent_contacts_db is distinct from old.consent_contacts_db
       or new.submission_ip_hash is distinct from old.submission_ip_hash
       or new.submission_user_agent is distinct from old.submission_user_agent then
      raise exception 'Pochodzenie zgloszenia i zgody zgloszajacego sa niezmienne'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.cases_guard_provenance() from public, anon;
grant execute on function public.cases_guard_provenance() to authenticated, service_role;

drop trigger if exists cases_guard_provenance on public.cases;
create trigger cases_guard_provenance
before insert or update on public.cases
for each row execute function public.cases_guard_provenance();

-- ============================================================================
-- 3. current_*_scope(): fail closed
-- ============================================================================
-- Wszystkie polityki uzywajace tych funkcji maja tez is_authenticated_active() i obejscie
-- is_posel(); service_role omija RLS. Zmiana dotyczy tylko konta bez aktywnego profilu.
create or replace function public.current_contacts_scope()
returns public.data_scope
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select coalesce(
    (select scope_contacts from public.profiles where id = auth.uid() and is_active = true),
    'own'::public.data_scope
  )
$$;

create or replace function public.current_cases_scope()
returns public.data_scope
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select coalesce(
    (select scope_cases from public.profiles where id = auth.uid() and is_active = true),
    'own'::public.data_scope
  )
$$;

create or replace function public.current_events_scope()
returns public.data_scope
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select coalesce(
    (select scope_events from public.profiles where id = auth.uid() and is_active = true),
    'own'::public.data_scope
  )
$$;

create or replace function public.current_interpellations_scope()
returns public.data_scope
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select coalesce(
    (select scope_interpellations from public.profiles where id = auth.uid() and is_active = true),
    'own'::public.data_scope
  )
$$;

-- ============================================================================
-- 4. Granty tabel
-- ============================================================================
-- PostgREST nie wykonuje TRUNCATE / REFERENCES / TRIGGER; zadna sciezka aplikacji ich
-- nie uzywa. SELECT/INSERT/UPDATE/DELETE zostaja (RLS decyduje).
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- audit_log pisza tylko funkcje SECURITY DEFINER (log_audit, triggery audytu);
-- oauth_codes obsluguje wylacznie service_role (RLS bez polityk).
revoke insert, update, delete on public.audit_log from authenticated;
revoke all on public.oauth_codes from authenticated;

-- ============================================================================
-- 5-6. profiles: pola publiczne (full_name, phone) i avatar_url
-- ============================================================================
-- Trigger zamiast CHECK: CHECK (takze NOT VALID) blokowalby kazdy UPDATE starego wiersza
-- niezgodnego z regula (np. dezaktywacje konta). Tu sprawdzana jest tylko nowa wartosc.
-- SECURITY INVOKER: current_user = rola wywolujacego (patrz cases_guard_provenance).
create or replace function public.profiles_validate_public_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_iss text;
  v_prefix text;
begin
  if tg_op = 'INSERT' or new.full_name is distinct from old.full_name then
    if char_length(btrim(new.full_name)) not between 2 and 120
       or new.full_name ~ '[[:cntrl:]]' then
      raise exception 'Imie i nazwisko: 2-120 znakow, bez znakow sterujacych'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' or new.phone is distinct from old.phone then
    new.phone := nullif(btrim(new.phone), '');
    if new.phone is not null and new.phone !~ '^[0-9 +()./-]{5,25}$' then
      raise exception 'Telefon: 5-25 znakow, tylko cyfry, spacje i + ( ) . / -'
        using errcode = '23514';
    end if;
  end if;

  -- profiles_avatar_url_storage_check sprawdza ksztalt (dowolny *.supabase.co); tu host
  -- tej instancji. iss = <SUPABASE_URL>/auth/v1, token podpisany przez GoTrue instancji.
  if new.avatar_url is not null
     and (tg_op = 'INSERT' or new.avatar_url is distinct from old.avatar_url)
     and current_user in ('authenticated', 'anon') then
    v_iss := auth.jwt() ->> 'iss';
    if v_iss is null or v_iss !~ '^https?://[^/?#]+/auth/v1$' then
      raise exception 'Nie mozna ustalic adresu instancji dla avatar_url'
        using errcode = '42501';
    end if;
    v_prefix := left(v_iss, -length('/auth/v1'))
      || '/storage/v1/object/public/avatars/' || new.id::text || '/';
    if not starts_with(new.avatar_url, v_prefix) then
      raise exception 'avatar_url musi wskazywac bucket avatars tej instancji'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_validate_public_fields() from public, anon;
grant execute on function public.profiles_validate_public_fields() to authenticated, service_role;

drop trigger if exists profiles_validate_public_fields on public.profiles;
create trigger profiles_validate_public_fields
before insert or update of full_name, phone, avatar_url on public.profiles
for each row execute function public.profiles_validate_public_fields();

-- ============================================================================
-- 7. SECURITY DEFINER: pg_temp na koncu search_path
-- ============================================================================
-- Zachowuje istniejaca liste schematow (public / public, auth) i pozostale ustawienia
-- (row_security). Funkcje rozszerzen pominiete. Nowe funkcje SECURITY DEFINER:
-- set search_path = public, pg_temp.
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
    if r.path is null or r.path ~ '(^|[ ,"])pg_temp([ ,"]|$)' then
      continue;
    end if;
    select string_agg(quote_ident(btrim(s, ' "')), ', ' order by o)
      into v_path
      from unnest(string_to_array(r.path, ',')) with ordinality as t(s, o)
     where btrim(s, ' "') <> '';
    execute format('alter function %s set search_path = %s, pg_temp', r.sig, v_path);
  end loop;
end;
$$;

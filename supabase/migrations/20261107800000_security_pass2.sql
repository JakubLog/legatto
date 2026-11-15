-- Audyt bezpieczenstwa 2026-11-07, druga runda (R2-05, R2-06/R30, R29, R27, R26/R2-10,
-- R28, R02, R49). Definicje bazowe pobrane z produkcji (pg_policies / pg_get_functiondef).
--
-- 1. profiles: DELETE wiersza profilu (polityka profiles_delete_posel albo kaskada z
--    auth.users) = kill switch: revoke_user_access(..., ban) + audyt. Przy kaskadzie z
--    usuniecia konta auth wiersz auth.users juz nie istnieje - ban dotyka 0 wierszy.
-- 2. EXECUTE na funkcjach: domyslne uprawnienia nowych funkcji bez PUBLIC/anon; istniejace
--    funkcje public wykonywalne przez anon (trigger fns, walidatory) traca PUBLIC/anon.
--    Wyjatek: celowe publiczne RPC get_public_* (anon zostaje, PUBLIC zdjety).
--    Funkcje triggerowe nie potrzebuja EXECUTE u wywolujacego, zeby trigger sie odpalil.
-- 3. is_aal2(): dodatkowo wymaga zweryfikowanego faktora MFA uzytkownika (sesja aal2 po
--    usunieciu ostatniego faktora nie daje juz dostepu).
-- 4. case_categories / offices: authenticated bez aal2 widzi tylko to co anon (kategorie
--    systemowe, aktywne biura); reszta wymaga is_authenticated_active() + is_aal2().
-- 5. newsletter_issues: status / slug / sent_at / gr_newsletter_id zmienia tylko
--    service_role (getresponse-proxy po udanej wysylce); wyslane wydanie niezmienne.
-- 6. log_client_event: limit 30 zdarzen mfa.* na uzytkownika na godzine; factor_id musi
--    nalezec do auth.uid() (enroll/verify_failed) albo nie nalezec do nikogo innego
--    (unenroll - faktor jest juz usuniety).
-- 7. mark_my_password_set: tylko aktywny profil (bez aal2 - PasswordSetupScreen na aal1).
-- 8. cases / contacts / events / interpellations: UPDATE i DELETE powtarzaja w USING
--    predykat zakresu (data_scope) z polityki SELECT (defense in depth).

-- ============================================================================
-- 1. Usuniecie profilu = kill switch
-- ============================================================================
create or replace function public.profiles_revoke_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public, auth
set row_security = off
as $$
declare
  v_result jsonb;
begin
  v_result := public.revoke_user_access(old.id, 'profile.delete', true);
  perform public.log_audit('user.access_revoked', 'profile', old.id,
    v_result || jsonb_build_object('full_name', old.full_name, 'email', old.email));
  return null;
end;
$$;

revoke all on function public.profiles_revoke_on_delete() from public, anon, authenticated;
grant execute on function public.profiles_revoke_on_delete() to service_role;

drop trigger if exists profiles_revoke_on_delete on public.profiles;
create trigger profiles_revoke_on_delete
after delete on public.profiles
for each row execute function public.profiles_revoke_on_delete();

-- ============================================================================
-- 2. EXECUTE: domyslne uprawnienia + istniejace funkcje anon
-- ============================================================================
-- Globalny default (PUBLIC) - per-schema REVOKE nie cofa globalnego grantu dla PUBLIC.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;

-- Prod 2026-11-07 (has_function_privilege('anon')): case_attachment_audit_trigger,
-- cases_set_resolved_at, ics_source_audit_trigger, office_audit_trigger,
-- profile_audit_trigger, profiles_guard_has_privacy_pin, set_created_by, set_updated_at,
-- validate_case_gmina, validate_contact_gmina, validate_event_gmina, validate_event_times
-- (anon + PUBLIC odebrane) oraz get_public_district, get_public_office_staff,
-- get_public_site_content, get_public_upcoming_events (anon zostaje, PUBLIC odebrany).
-- Petla obejmuje tez funkcje z migracji lokalnych innych sesji; authenticated /
-- service_role dostaja grant tylko tam, gdzie mieli EXECUTE wczesniej (takze przez PUBLIC).
do $$
declare
  r record;
  v_auth boolean;
  v_service boolean;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind in ('f', 'p')
       and has_function_privilege('anon', p.oid, 'EXECUTE')
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
       )
  loop
    v_auth := has_function_privilege('authenticated', r.oid, 'EXECUTE');
    v_service := has_function_privilege('service_role', r.oid, 'EXECUTE');

    if r.proname like 'get\_public\_%' then
      execute format('revoke execute on function %s from public', r.sig);
      execute format('grant execute on function %s to anon', r.sig);
    else
      execute format('revoke execute on function %s from public, anon', r.sig);
    end if;

    if v_auth then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    if v_service then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;

    raise notice 'EXECUTE anon/PUBLIC: %', r.sig;
  end loop;
end;
$$;

-- ============================================================================
-- 3. is_aal2(): sesja + zweryfikowany faktor MFA
-- ============================================================================
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
     and exists (
       select 1
         from auth.mfa_factors f
        where f.user_id = auth.uid()
          and f.status = 'verified'
     )
$$;

revoke all on function public.is_aal2() from public, anon;
grant execute on function public.is_aal2() to authenticated, service_role;

-- ============================================================================
-- 4. case_categories / offices: aal1 = widok anon
-- ============================================================================
drop policy if exists case_categories_select_authenticated on public.case_categories;
create policy case_categories_select_authenticated
on public.case_categories for select
to authenticated
using (is_system = true or (public.is_authenticated_active() and public.is_aal2()));

drop policy if exists offices_select_authenticated on public.offices;
create policy offices_select_authenticated
on public.offices for select
to authenticated
using (is_active = true or (public.is_authenticated_active() and public.is_aal2()));

-- ============================================================================
-- 5. newsletter_issues: publikacja tylko przez service_role
-- ============================================================================
-- SECURITY INVOKER: current_user = rola wywolujacego (authenticated / service_role).
create or replace function public.newsletter_issues_guard_publish()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.status is distinct from 'draft' or new.sent_at is not null
         or new.gr_newsletter_id is not null then
        raise exception 'Nowe wydanie newslettera musi byc szkicem' using errcode = '42501';
      end if;
      -- Adres /n/<slug> zawsze losowy, nie wybierany przez klienta.
      new.slug := translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/', '-_');
    else
      if old.status is distinct from 'draft' then
        raise exception 'Wyslane wydanie newslettera jest niezmienne' using errcode = '42501';
      end if;
      if new.status is distinct from old.status
         or new.slug is distinct from old.slug
         or new.sent_at is distinct from old.sent_at
         or new.gr_newsletter_id is distinct from old.gr_newsletter_id then
        raise exception 'Status, adres i dane wysylki wydania ustawia tylko serwer po wysylce'
          using errcode = '42501';
      end if;
    end if;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public.log_audit('newsletter.issue_status', 'newsletter_issue', new.id,
      jsonb_build_object('from', old.status, 'to', new.status, 'slug', new.slug,
        'gr_newsletter_id', new.gr_newsletter_id, 'subject', new.subject));
  end if;
  return new;
end;
$$;

revoke all on function public.newsletter_issues_guard_publish() from public, anon;
grant execute on function public.newsletter_issues_guard_publish() to authenticated, service_role;

drop trigger if exists newsletter_issues_guard_publish on public.newsletter_issues;
create trigger newsletter_issues_guard_publish
before insert or update on public.newsletter_issues
for each row execute function public.newsletter_issues_guard_publish();

drop policy if exists newsletter_issues_update_draft_writer on public.newsletter_issues;
create policy newsletter_issues_update_draft_writer
on public.newsletter_issues for update
to authenticated
using (public.is_writer() and public.is_aal2() and status = 'draft')
with check (public.is_writer() and public.is_aal2() and status = 'draft');

-- ============================================================================
-- 6. log_client_event: limit + factor_id uzytkownika
-- ============================================================================
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
  v_recent integer;
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
      if v_factor_id !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' then
        raise exception 'Niepoprawny factor_id' using errcode = '22023';
      end if;
      if p_action = 'mfa.unenroll' then
        -- Faktor jest juz usuniety; nie moze byc cudzym faktorem.
        if exists (select 1 from auth.mfa_factors f
                    where f.id = v_factor_id::uuid and f.user_id <> v_user_id) then
          raise exception 'Niepoprawny factor_id' using errcode = '22023';
        end if;
      elsif not exists (select 1 from auth.mfa_factors f
                         where f.id = v_factor_id::uuid and f.user_id = v_user_id) then
        raise exception 'Niepoprawny factor_id' using errcode = '22023';
      end if;
      v_metadata := jsonb_build_object('factor_id', v_factor_id);
    end if;
  end if;

  -- Limit: 30 zdarzen mfa.* z klienta na uzytkownika na godzine (serializacja per user).
  perform pg_advisory_xact_lock(hashtext('eposel.log_client_event:' || v_user_id::text));
  select count(*) into v_recent
    from public.audit_log a
   where a.user_id = v_user_id
     and a.action in ('mfa.enroll', 'mfa.verify_failed', 'mfa.unenroll')
     and a.created_at > now() - interval '1 hour';
  if v_recent >= 30 then
    raise exception 'Zbyt wiele zdarzen audytu - sprobuj pozniej' using errcode = '54000';
  end if;

  perform public.log_audit(p_action, 'profile', v_user_id, v_metadata);
end;
$$;

revoke all on function public.log_client_event(text, text, uuid, jsonb) from public, anon;
grant execute on function public.log_client_event(text, text, uuid, jsonb) to authenticated, service_role;

-- ============================================================================
-- 7. mark_my_password_set: tylko aktywny profil
-- ============================================================================
create or replace function public.mark_my_password_set()
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if auth.uid() is null or not public.is_authenticated_active() then
    raise exception 'Brak sesji' using errcode = '42501';
  end if;
  update public.profiles
     set password_set = true,
         updated_at   = now()
   where id = auth.uid();
end;
$$;

revoke all on function public.mark_my_password_set() from public, anon;
grant execute on function public.mark_my_password_set() to authenticated, service_role;

-- ============================================================================
-- 8. UPDATE / DELETE z predykatem zakresu z SELECT
-- ============================================================================
drop policy if exists cases_update_writer on public.cases;
create policy cases_update_writer
on public.cases for update
to authenticated
using (
  public.is_writer() and public.is_aal2() and public.is_authenticated_active()
  and (public.is_posel() or public.current_cases_scope() = 'all'::public.data_scope
       or created_by = auth.uid() or assigned_to = auth.uid())
)
with check (public.is_writer() and public.is_aal2());

drop policy if exists cases_delete_posel on public.cases;
create policy cases_delete_posel
on public.cases for delete
to authenticated
using (
  public.is_posel() and public.is_aal2() and public.is_authenticated_active()
  and (public.is_posel() or public.current_cases_scope() = 'all'::public.data_scope
       or created_by = auth.uid() or assigned_to = auth.uid())
);

drop policy if exists contacts_update_writer on public.contacts;
create policy contacts_update_writer
on public.contacts for update
to authenticated
using (
  public.is_writer() and public.is_aal2() and public.is_authenticated_active()
  and (public.is_posel() or public.current_contacts_scope() = 'all'::public.data_scope
       or created_by = auth.uid())
)
with check (public.is_writer() and public.is_aal2());

drop policy if exists contacts_delete_posel on public.contacts;
create policy contacts_delete_posel
on public.contacts for delete
to authenticated
using (
  public.is_posel() and public.is_aal2() and public.is_authenticated_active()
  and (public.is_posel() or public.current_contacts_scope() = 'all'::public.data_scope
       or created_by = auth.uid())
);

drop policy if exists events_update_writer on public.events;
create policy events_update_writer
on public.events for update
to authenticated
using (
  public.is_writer() and public.is_aal2() and public.is_authenticated_active()
  and (public.is_posel() or public.current_events_scope() = 'all'::public.data_scope
       or created_by = auth.uid() or assigned_to = auth.uid())
)
with check (public.is_writer() and public.is_aal2());

drop policy if exists events_delete_posel on public.events;
create policy events_delete_posel
on public.events for delete
to authenticated
using (
  public.is_posel() and public.is_aal2() and public.is_authenticated_active()
  and (public.is_posel() or public.current_events_scope() = 'all'::public.data_scope
       or created_by = auth.uid() or assigned_to = auth.uid())
);

drop policy if exists interpellations_update_writer on public.interpellations;
create policy interpellations_update_writer
on public.interpellations for update
to authenticated
using (
  public.is_writer() and public.is_aal2() and public.is_authenticated_active()
  and (public.is_posel() or public.current_interpellations_scope() = 'all'::public.data_scope
       or created_by = auth.uid())
)
with check (public.is_writer() and public.is_aal2());

drop policy if exists interpellations_delete_posel on public.interpellations;
create policy interpellations_delete_posel
on public.interpellations for delete
to authenticated
using (
  public.is_posel() and public.is_aal2() and public.is_authenticated_active()
  and (public.is_posel() or public.current_interpellations_scope() = 'all'::public.data_scope
       or created_by = auth.uid())
);

-- ePosel — Wzmocnienie uprawnien (FE <-> BE consistency review)
--
-- Cel: zlikwidowac rozjazd miedzy frontendem a RLS oraz uciszyc warningi
-- z `supabase get_advisors`.
--
-- ============================================================================
-- 1. profiles_update_self — strict WITH CHECK (krytyczna luka)
-- ============================================================================
-- Stara polityka pozwalala zalogowanemu userowi zmienic SOBIE: email, office_id,
-- password_set (i inne kolumny), bo WITH CHECK blokowal jedynie role/is_active.
-- Frontend (`useUpdateMyProfile`) wysyla tylko full_name/phone/avatar_url/is_public,
-- ale REST byl otwarty na samowole (np. asystent przepisujacy sie do innego biura).
--
-- Nowa polityka: dodatkowo blokujemy email, office_id, password_set, created_at, id.
-- Flage password_set ustawia teraz dedykowany RPC `mark_my_password_set()`
-- (uzywany przez PasswordSetupScreen po `auth.updateUser({ password })`).

drop policy if exists profiles_update_self on public.profiles;

create policy profiles_update_self
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and email         = (select email         from public.profiles where id = auth.uid())
  and role          = (select role          from public.profiles where id = auth.uid())
  and is_active     = (select is_active     from public.profiles where id = auth.uid())
  and office_id is not distinct from (select office_id from public.profiles where id = auth.uid())
  and password_set  = (select password_set  from public.profiles where id = auth.uid())
  and created_at    = (select created_at    from public.profiles where id = auth.uid())
);

-- ============================================================================
-- 2. RPC `mark_my_password_set` — pozwala self ustawic flagę password_set=true
-- ============================================================================
-- Wywolywane z PasswordSetupScreen po pomyslnym `auth.updateUser({ password })`.
-- SECURITY DEFINER, bo polityka profiles_update_self juz nie pozwala na zmiane
-- tej kolumny. Funkcja sprawdza, ze caller ustawia flage TYLKO sobie.

create or replace function public.mark_my_password_set()
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if auth.uid() is null then
    raise exception 'Brak sesji' using errcode = '42501';
  end if;
  update public.profiles
     set password_set = true,
         updated_at   = now()
   where id = auth.uid();
end;
$$;

revoke all on function public.mark_my_password_set() from public;
grant execute on function public.mark_my_password_set() to authenticated;

-- ============================================================================
-- 3. SET search_path na funkcjach (likwidacja `function_search_path_mutable`)
-- ============================================================================
-- Triggery i helpery bez search_path - alter wlasnie tej wlasciwosci, bez
-- przepisywania cial (zachowujemy semantyke).

alter function public.set_created_by()                set search_path = public;
alter function public.set_updated_at()                set search_path = public;
alter function public.cases_set_resolved_at()         set search_path = public;
alter function public.interpellations_set_sent_at()   set search_path = public;
alter function public.validate_case_gmina()           set search_path = public;
alter function public.validate_contact_gmina()        set search_path = public;
alter function public.validate_event_gmina()          set search_path = public;
alter function public.validate_event_times()          set search_path = public;

-- ============================================================================
-- 4. Revoke EXECUTE FROM PUBLIC na helperach i triggerach SECURITY DEFINER
-- ============================================================================
-- (likwidacja `anon_security_definer_function_executable`
--  + `authenticated_security_definer_function_executable`)
--
-- Triggery (case_audit_trigger, contact_audit_trigger, event_audit_trigger,
-- interpellation_audit_trigger, app_settings_audit_trigger, app_settings_set_meta)
-- sa wywolywane wylacznie przez postgres trigger system, nie powinny byc
-- dostepne przez REST RPC.
--
-- Helpery (is_posel, is_writer, is_authenticated_active, current_role,
-- current_office_id, log_audit) sa uzywane WEWNATRZ policies (czyli wykonywane
-- jako `authenticated`), wiec dostep dla `authenticated` zostaje, REVOKE
-- dotyczy tylko `public`/`anon`.

-- 4a. Triggery — odbieramy WSZYSTKIM (postgres triggery i tak ich nie potrzebuja
--     w katalogu `routine_privileges`).
revoke all on function public.case_audit_trigger()             from public;
revoke all on function public.contact_audit_trigger()          from public;
revoke all on function public.event_audit_trigger()            from public;
revoke all on function public.interpellation_audit_trigger()   from public;
revoke all on function public.app_settings_audit_trigger()     from public;
revoke all on function public.app_settings_set_meta()          from public;

-- 4b. Helpery RLS — anon nie ich nie potrzebuje (zadna anon policy ich nie wola).
--     authenticated potrzebuje, bo policies uzywaja ich w USING/WITH CHECK.
revoke all on function public.is_posel()                       from public;
revoke all on function public.is_writer()                      from public;
revoke all on function public.is_authenticated_active()        from public;
revoke all on function public.current_role()                   from public;
revoke all on function public.current_office_id()              from public;
revoke all on function public.log_audit(text, text, uuid, jsonb) from public;

grant execute on function public.is_posel()                       to authenticated;
grant execute on function public.is_writer()                      to authenticated;
grant execute on function public.is_authenticated_active()        to authenticated;
grant execute on function public.current_role()                   to authenticated;
grant execute on function public.current_office_id()              to authenticated;
grant execute on function public.log_audit(text, text, uuid, jsonb) to authenticated;

-- 4c. RPC widoczne publicznie celowo (publiczna lista pracownikow biura)
--     `get_public_office_staff` — pozostawiamy dostep dla anon i authenticated.
--     `get_office_colleagues`, `get_assignable_users`, `get_all_users_admin` —
--     tylko authenticated (sprawdzaja role wewnatrz).
revoke all on function public.get_public_office_staff(uuid)       from public;
revoke all on function public.get_office_colleagues(uuid)         from public;
revoke all on function public.get_assignable_users()              from public;
revoke all on function public.get_all_users_admin()               from public;

grant execute on function public.get_public_office_staff(uuid)    to anon, authenticated;
grant execute on function public.get_office_colleagues(uuid)      to authenticated;
grant execute on function public.get_assignable_users()           to authenticated;
grant execute on function public.get_all_users_admin()            to authenticated;

-- ============================================================================
-- 5. Avatars bucket — usuniecie broad SELECT policy
-- ============================================================================
-- Public bucket nie potrzebuje SELECT policy do udostepniania URL-i (CDN
-- routing dziala na podstawie `buckets.public = true`). Bez tej polityki
-- klienci NIE moga listowac wszystkich plikow w bucket przez `storage.list`,
-- ale mozna nadal pobrac konkretny URL (`/storage/v1/object/public/avatars/...`).

drop policy if exists avatars_public_read on storage.objects;

-- ePosel - RLS hardening: wymóg aal2 (TOTP) na wrażliwych tabelach
--
-- Kontekst:
-- Sam ProtectedRoute (frontend) blokuje wejście do portalu bez 2FA, ale RLS
-- sprawdzała tylko `is_authenticated_active()` - wykradziony access token (aal1)
-- pozwalał obejść MFA przez bezpośredni REST.
--
-- Po tej migracji wszystkie wrażliwe tabele (cases, contacts, events,
-- interpellations, audit_log, app_settings, case_categories CUD, offices CUD,
-- profiles UPDATE-self/posel + INSERT/DELETE) wymagają sessji z `aal=aal2`.
--
-- Zostaje BEZ aal2 (musi działać przed/podczas flow MFA):
-- - profiles SELECT self (AuthContext fetchuje profile przed MfaChallengeScreen)
-- - offices SELECT (publiczny + authenticated wgląd w portalu pre-MFA)
-- - powiaty / gminy SELECT (słowniki publiczne)
-- - case_categories SELECT (publiczna lista systemowych dla formularza zgłoszeń)
-- - storage avatars (osobne RLS, niski risk, profile-only)
-- - SECURITY DEFINER RPC (bypassują RLS, w tym mark_my_password_set, log_audit)

-- ============================================================================
-- 1. Helper is_aal2()
-- ============================================================================
create or replace function public.is_aal2()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
$$;

revoke all on function public.is_aal2() from public, anon;
grant execute on function public.is_aal2() to authenticated, service_role;

-- ============================================================================
-- 2. profiles - INSERT/UPDATE/DELETE wymagają aal2; SELECT-self BEZ aal2
-- ============================================================================
drop policy if exists profiles_insert_posel on public.profiles;
create policy profiles_insert_posel on public.profiles
  for insert to authenticated
  with check (is_posel() and is_aal2());

drop policy if exists profiles_update_posel on public.profiles;
create policy profiles_update_posel on public.profiles
  for update to authenticated
  using (is_posel() and is_aal2())
  with check (is_posel() and is_aal2());

drop policy if exists profiles_delete_posel on public.profiles;
create policy profiles_delete_posel on public.profiles
  for delete to authenticated
  using (is_posel() and is_aal2());

-- profiles_update_self: zachowujemy strict WITH CHECK z `tighten_permissions`
-- + dodajemy wymog aal2.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() and is_aal2())
  with check (
    id = auth.uid()
    and is_aal2()
    and email         = (select email         from public.profiles where id = auth.uid())
    and role          = (select role          from public.profiles where id = auth.uid())
    and is_active     = (select is_active     from public.profiles where id = auth.uid())
    and office_id is not distinct from (select office_id from public.profiles where id = auth.uid())
    and password_set  = (select password_set  from public.profiles where id = auth.uid())
    and privacy_pin_hash is not distinct from (select privacy_pin_hash from public.profiles where id = auth.uid())
    and created_at    = (select created_at    from public.profiles where id = auth.uid())
  );

-- profiles_select_self ZOSTAJE BEZ aal2 (AuthContext fetch w stanie aal1)

-- ============================================================================
-- 3. offices - SELECT bez aal2; CUD wymaga aal2
-- ============================================================================
drop policy if exists offices_insert_posel on public.offices;
create policy offices_insert_posel on public.offices
  for insert to authenticated
  with check (is_posel() and is_aal2());

drop policy if exists offices_update_posel on public.offices;
create policy offices_update_posel on public.offices
  for update to authenticated
  using (is_posel() and is_aal2())
  with check (is_posel() and is_aal2());

drop policy if exists offices_delete_posel on public.offices;
create policy offices_delete_posel on public.offices
  for delete to authenticated
  using (is_posel() and is_aal2());

-- ============================================================================
-- 4. audit_log - SELECT wymaga aal2 (UPDATE/DELETE zostaja false)
-- ============================================================================
drop policy if exists audit_log_select_posel on public.audit_log;
create policy audit_log_select_posel on public.audit_log
  for select to authenticated
  using (is_posel() and is_aal2());

-- ============================================================================
-- 5. cases - wszystko aal2
-- ============================================================================
drop policy if exists cases_select_authenticated on public.cases;
create policy cases_select_authenticated on public.cases
  for select to authenticated
  using (is_authenticated_active() and is_aal2());

drop policy if exists cases_insert_writer on public.cases;
create policy cases_insert_writer on public.cases
  for insert to authenticated
  with check (is_writer() and is_aal2());

drop policy if exists cases_update_writer on public.cases;
create policy cases_update_writer on public.cases
  for update to authenticated
  using (is_writer() and is_aal2())
  with check (is_writer() and is_aal2());

drop policy if exists cases_delete_posel on public.cases;
create policy cases_delete_posel on public.cases
  for delete to authenticated
  using (is_posel() and is_aal2());

-- ============================================================================
-- 6. contacts - wszystko aal2
-- ============================================================================
drop policy if exists contacts_select_authenticated on public.contacts;
create policy contacts_select_authenticated on public.contacts
  for select to authenticated
  using (is_authenticated_active() and is_aal2());

drop policy if exists contacts_insert_writer on public.contacts;
create policy contacts_insert_writer on public.contacts
  for insert to authenticated
  with check (is_writer() and is_aal2());

drop policy if exists contacts_update_writer on public.contacts;
create policy contacts_update_writer on public.contacts
  for update to authenticated
  using (is_writer() and is_aal2())
  with check (is_writer() and is_aal2());

drop policy if exists contacts_delete_posel on public.contacts;
create policy contacts_delete_posel on public.contacts
  for delete to authenticated
  using (is_posel() and is_aal2());

-- ============================================================================
-- 7. events - wszystko aal2
-- ============================================================================
drop policy if exists events_select_authenticated on public.events;
create policy events_select_authenticated on public.events
  for select to authenticated
  using (is_authenticated_active() and is_aal2());

drop policy if exists events_insert_writer on public.events;
create policy events_insert_writer on public.events
  for insert to authenticated
  with check (is_writer() and is_aal2());

drop policy if exists events_update_writer on public.events;
create policy events_update_writer on public.events
  for update to authenticated
  using (is_writer() and is_aal2())
  with check (is_writer() and is_aal2());

drop policy if exists events_delete_posel on public.events;
create policy events_delete_posel on public.events
  for delete to authenticated
  using (is_posel() and is_aal2());

-- ============================================================================
-- 8. interpellations - wszystko aal2
-- ============================================================================
drop policy if exists interpellations_select_authenticated on public.interpellations;
create policy interpellations_select_authenticated on public.interpellations
  for select to authenticated
  using (is_authenticated_active() and is_aal2());

drop policy if exists interpellations_insert_writer on public.interpellations;
create policy interpellations_insert_writer on public.interpellations
  for insert to authenticated
  with check (is_writer() and is_aal2());

drop policy if exists interpellations_update_writer on public.interpellations;
create policy interpellations_update_writer on public.interpellations
  for update to authenticated
  using (is_writer() and is_aal2())
  with check (is_writer() and is_aal2());

drop policy if exists interpellations_delete_posel on public.interpellations;
create policy interpellations_delete_posel on public.interpellations
  for delete to authenticated
  using (is_posel() and is_aal2());

-- ============================================================================
-- 9. app_settings - wszystko aal2
-- ============================================================================
drop policy if exists app_settings_select_posel on public.app_settings;
create policy app_settings_select_posel on public.app_settings
  for select to authenticated
  using (is_posel() and is_aal2());

drop policy if exists app_settings_insert_posel on public.app_settings;
create policy app_settings_insert_posel on public.app_settings
  for insert to authenticated
  with check (is_posel() and is_aal2());

drop policy if exists app_settings_update_posel on public.app_settings;
create policy app_settings_update_posel on public.app_settings
  for update to authenticated
  using (is_posel() and is_aal2())
  with check (is_posel() and is_aal2());

-- ============================================================================
-- 10. case_categories - SELECT bez aal2 (publiczne); CUD aal2
-- ============================================================================
-- SELECT zostaje:
-- - case_categories_public_read_system (anon, is_system=true) — bez zmian
-- - case_categories_select_authenticated — bez zmian (musi widziec authenticated user
--   przed enrollment? raczej nie potrzebuje. Ale nie tracimy nic na zostawieniu).
--
-- INSERT/UPDATE/DELETE - aal2

drop policy if exists case_categories_insert_writer on public.case_categories;
create policy case_categories_insert_writer on public.case_categories
  for insert to authenticated
  with check (is_writer() and is_aal2() and is_system = false);

drop policy if exists case_categories_update_posel on public.case_categories;
create policy case_categories_update_posel on public.case_categories
  for update to authenticated
  using (is_posel() and is_aal2() and is_system = false)
  with check (is_posel() and is_aal2() and is_system = false);

drop policy if exists case_categories_delete_posel on public.case_categories;
create policy case_categories_delete_posel on public.case_categories
  for delete to authenticated
  using (is_posel() and is_aal2() and is_system = false);

-- ============================================================================
-- UWAGI:
-- - public_form INSERT do `cases` przez Edge Function `public-submit-case` uzywa
--   service_role - service_role bypassuje RLS, wiec aal2 sprawdzenie nie dotyczy.
-- - Edge Functions `admin-create-user`, `admin-delete-user`, `admin-reset-user-mfa`,
--   `generate-interpellation` uzywaja albo service_role (bypass) albo callerClient
--   (sprawdza is_posel/is_writer ale nie aal). W praktyce caller w tych funkcjach
--   musi byc juz w aal2 zeby dostac sie do Admin UI/Interpellations editor —
--   wymuszone przez ProtectedRoute. Edge Function nie sprawdza aal explicite (mala
--   warstwa redundancji do dolozenia poza MVP gdyby trzeba bylo).
-- - Jezeli ktos w trakcie testow chce wywalic ten hardening lokalnie, wystarczy
--   `drop function public.is_aal2()` i recreate policies bez tego helpera.
-- ============================================================================

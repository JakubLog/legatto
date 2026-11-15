-- ePosel — Explicit REVOKE FROM anon na helperach i triggerach
--
-- Dlaczego osobna migracja:
-- Poprzednia (20260504000000_tighten_permissions.sql) uzywala `REVOKE ... FROM PUBLIC`,
-- ale Supabase przy tworzeniu funkcji nadaje EXPLICIT granty `anon` i `authenticated`
-- (przez `ALTER DEFAULT PRIVILEGES`). REVOKE FROM PUBLIC nie usuwa tych grantow,
-- bo PUBLIC to inna pseudorola. Trzeba revoke od konkretnych roli.
--
-- Zweryfikowane przez `SELECT proacl FROM pg_proc`:
-- {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- Realna luka: log_audit() jest wywolywalne przez anon przez REST /rpc/log_audit
-- (anon moze wstawic dowolny wpis do audit_log z user_id=NULL).

-- ============================================================================
-- 1. Triggery — REVOKE FROM anon, authenticated (wolane wylacznie przez postgres)
-- ============================================================================
revoke execute on function public.case_audit_trigger()             from anon, authenticated;
revoke execute on function public.contact_audit_trigger()          from anon, authenticated;
revoke execute on function public.event_audit_trigger()            from anon, authenticated;
revoke execute on function public.interpellation_audit_trigger()   from anon, authenticated;
revoke execute on function public.app_settings_audit_trigger()     from anon, authenticated;
revoke execute on function public.app_settings_set_meta()          from anon, authenticated;

-- ============================================================================
-- 2. Helpery RLS — REVOKE FROM anon (authenticated potrzebuje przy ewaluacji policies)
-- ============================================================================
revoke execute on function public.is_posel()                       from anon;
revoke execute on function public.is_writer()                      from anon;
revoke execute on function public.is_authenticated_active()        from anon;
revoke execute on function public.current_role()                   from anon;
revoke execute on function public.current_office_id()              from anon;

-- log_audit — KRYTYCZNE: anon mogl spamowac audit_log
revoke execute on function public.log_audit(text, text, uuid, jsonb) from anon;

-- ============================================================================
-- 3. RPC admin/internal — REVOKE FROM anon (authenticated z self-checkiem wewnatrz)
-- ============================================================================
revoke execute on function public.get_all_users_admin()            from anon;
revoke execute on function public.get_assignable_users()           from anon;
revoke execute on function public.get_office_colleagues(uuid)      from anon;
revoke execute on function public.mark_my_password_set()           from anon;

-- ============================================================================
-- 4. Publicznie celowe funkcje — pozostawiamy dostep dla anon
-- ============================================================================
-- get_public_office_staff(uuid)         — publiczna lista pracownikow biura
-- get_public_upcoming_events(p_limit)   — publiczne nadchodzace wydarzenia
-- (nie revoke; default Supabase grants OK)

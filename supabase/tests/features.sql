-- Testy migracji Legatto (A5, A6, A7, A8, A12, A13) na lokalnym Postgresie Supabase.
-- Uruchamia supabase/tests/run-features.sh (świeża baza + wszystkie migracje). Każdy blok DO
-- rzuca wyjątek przy niespełnionej asercji; psql z ON_ERROR_STOP kończy się kodem ≠ 0.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Fixture: Poseł z sesją aal2 i zweryfikowanym MFA, Pracownik bez MFA.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, instance_id)
values ('11111111-1111-4111-8111-111111111111', 'posel@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
       ('22222222-2222-4222-8222-222222222222', 'pracownik@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, email, full_name, role)
values ('11111111-1111-4111-8111-111111111111', 'posel@test.local', 'Jan Poseł', 'posel'),
       ('22222222-2222-4222-8222-222222222222', 'pracownik@test.local', 'Anna Pracownik', 'pracownik');
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', now(), now(), 'aal2');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 't', 'totp', 'verified', now(), now());

create or replace function pg_temp.as_posel(p_surface text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2',
    'session_id', '33333333-3333-4333-8333-333333333333')::text, true);
  perform set_config('request.headers',
    case when p_surface is null then '{}' else json_build_object('x-legatto-surface', p_surface)::text end, true);
end $$;

-- ---------------------------------------------------------------------------
-- A5: require_admin_surface
-- ---------------------------------------------------------------------------
begin;
select pg_temp.as_posel('admin');
do $$ begin perform public.require_admin_surface(); end $$;
select pg_temp.as_posel(null);
do $$ begin perform public.require_admin_surface(); end $$;  -- brak nagłówka, brak wymuszania: OK
select pg_temp.as_posel('crm');
do $$
begin
  perform public.require_admin_surface();
  raise exception 'FAIL: crm przeszło require_admin_surface';
exception when insufficient_privilege then null;
end $$;
select set_config('legatto.surface_enforce', 'on', true);
select pg_temp.as_posel(null);
do $$
begin
  perform public.require_admin_surface();
  raise exception 'FAIL: brak nagłówka przy wymuszaniu przeszedł';
exception when insufficient_privilege then null;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- A13: eksport tylko na admin, bez sekretów, z audytem
-- ---------------------------------------------------------------------------
begin;
insert into public.app_settings (key, value) values ('test_api_key', '"tajne"') on conflict (key) do update set value = excluded.value;
select pg_temp.as_posel('admin');
do $$
declare
  v jsonb;
begin
  v := public.export_office_data('profiles', 0, 10);
  if jsonb_array_length(v) < 2 then raise exception 'FAIL: eksport profiles %', v; end if;
  v := public.export_office_data('app_settings', 0, 1000);
  if exists (select 1 from jsonb_array_elements(v) r where r ->> 'key' = 'test_api_key') then
    raise exception 'FAIL: sekret w eksporcie app_settings';
  end if;
  perform public.export_log('started', '{}'::jsonb);
  begin
    perform public.export_office_data('mcp_tokens', 0, 10);
    raise exception 'FAIL: tabela spoza listy';
  exception when invalid_parameter_value then null;
  end;
end $$;
select pg_temp.as_posel('crm');
do $$
begin
  perform public.export_office_data('cases', 0, 10);
  raise exception 'FAIL: eksport z crm';
exception when insufficient_privilege then null;
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.audit_log where action = 'data.export_started'
                   and metadata ->> 'surface' = 'admin') then
    raise exception 'FAIL: brak audytu eksportu';
  end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- A12: posts (RLS Poseł+aal2, audyt, published_at)
-- ---------------------------------------------------------------------------
begin;
select pg_temp.as_posel('crm');
insert into public.posts (slug, title, body_md, status) values ('pierwszy-wpis', 'Pierwszy wpis', '# Witam', 'published');
do $$
begin
  if (select published_at from public.posts where slug = 'pierwszy-wpis') is null then
    raise exception 'FAIL: published_at nie ustawione';
  end if;
  if (select author_id from public.posts where slug = 'pierwszy-wpis') <> '11111111-1111-4111-8111-111111111111' then
    raise exception 'FAIL: author_id';
  end if;
end $$;
-- Pracownik: brak dostępu (RLS)
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-4222-8222-222222222222',
  'role', 'authenticated', 'aal', 'aal1')::text, true);
do $$
begin
  if exists (select 1 from public.posts) then raise exception 'FAIL: pracownik widzi posts'; end if;
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.audit_log where action = 'post.create') then
    raise exception 'FAIL: brak audytu post.create';
  end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- A6/A8: publikacja strony, migawka, newsletter po publikacji
-- ---------------------------------------------------------------------------
begin;
update public.app_settings set value = '"https://jan-kowalski.pl"' where key = 'public_site_url';
do $$
begin
  begin
    update public.app_settings set value = '"http://zly.pl/sciezka"' where key = 'public_site_url';
    raise exception 'FAIL: niepoprawny public_site_url przyjęty';
  exception when invalid_parameter_value then null;
  end;
end $$;
insert into public.newsletter_issues (id, subject, template, html_web)
values ('55555555-5555-4555-8555-555555555555', 'Newsletter testowy', '{}',
        '<img src="https://jan-kowalski.pl/n/a/' || repeat('a', 64) || '.png">');
insert into storage.objects (bucket_id, name, metadata)
values ('newsletter-assets', '11111111-1111-4111-8111-111111111111/' || repeat('a', 64) || '.png', '{"size": 10}');
insert into public.posts (slug, title, status) values ('wpis', 'Wpis', 'published');
select pg_temp.as_posel('crm');
select public.request_newsletter_publication('55555555-5555-4555-8555-555555555555') as job \gset
do $$
begin
  update public.newsletter_issues set subject = 'zmiana' where id = '55555555-5555-4555-8555-555555555555';
  raise exception 'FAIL: zgłoszone wydanie da się edytować';
exception when insufficient_privilege then null;
end $$;
reset role;
set role legatto_publisher;
do $$
declare
  v_job uuid;
  v_snap jsonb;
begin
  select job_id into v_job from public.service_site_publisher_claim();
  if v_job is null then raise exception 'FAIL: claim nie zwrócił joba'; end if;
  v_snap := public.service_site_snapshot();
  if v_snap ->> 'schema_version' <> '1' or v_snap ->> 'public_site_url' <> 'https://jan-kowalski.pl' then
    raise exception 'FAIL: migawka %', v_snap - 'dictionaries';
  end if;
  if jsonb_array_length(v_snap -> 'newsletters') <> 1 or jsonb_array_length(v_snap -> 'newsletter_assets') <> 1
     or jsonb_array_length(v_snap -> 'posts') <> 1 then
    raise exception 'FAIL: newsletter/zasoby/posty w migawce';
  end if;
  perform public.service_site_publisher_finish(v_job, 'ok', 'dep-123', null);
  begin
    perform count(*) from public.cases;
    raise exception 'FAIL: publisher czyta cases';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  if (select web_published_at from public.newsletter_issues where id = '55555555-5555-4555-8555-555555555555') is null then
    raise exception 'FAIL: web_published_at nie ustawione po publikacji';
  end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- A6: anon bez get_public_* i słowników
-- ---------------------------------------------------------------------------
begin;
set local role anon;
do $$
begin
  begin
    perform public.get_public_site_content();
    raise exception 'FAIL: anon wykonuje get_public_site_content';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.powiaty;
    raise exception 'FAIL: anon czyta powiaty';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.service_site_snapshot();
    raise exception 'FAIL: anon wykonuje service_site_snapshot';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- A7: intake.submit_public_case (rola legatto_intake)
-- ---------------------------------------------------------------------------
begin;
do $$
declare
  v_form jsonb := jsonb_build_object('reporter_name', 'Jan Testowy', 'reporter_email', 'jan@example.pl',
    'reporter_phone', null, 'powiat_id', (select g.powiat_id from public.gminy g order by g.id limit 1),
    'gmina_id', (select g.id from public.gminy g order by g.id limit 1),
    'category_id', (select c.id from public.case_categories c where c.is_system order by c.id limit 1),
    'title', 'Dziura w drodze', 'description', 'Opis dłuższy niż dwadzieścia znaków.',
    'rodo_consent', true, 'consent_newsletter', false, 'consent_contacts_db', true);
  v_base jsonb;
  r text;
begin
  perform set_config('role', 'legatto_intake', true);
  v_base := jsonb_build_object('id', '6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f', 'kind', 'submission', 'ref', 'abcdef01',
    'received_at', '2026-11-21T12:00:00Z', 'meta', jsonb_build_object('ip_hash', repeat('b', 64), 'ua', 'UA'));
  r := intake.submit_public_case(v_base || jsonb_build_object('form', v_form || '{"category_id": 999999}'));
  if r <> 'rejected_validation' then raise exception 'FAIL: zła kategoria -> %', r; end if;
  r := intake.submit_public_case(v_base || jsonb_build_object('form', v_form));
  if r <> 'duplicate' then raise exception 'FAIL: to samo id po odrzuceniu -> %', r; end if;
  v_base := jsonb_set(v_base, '{id}', '"7f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"');
  r := intake.submit_public_case(v_base || jsonb_build_object('form', v_form || '{"reporter_name": "Jan\u202eX"}'));
  if r <> 'rejected_validation' then raise exception 'FAIL: bidi -> %', r; end if;
  v_base := jsonb_set(v_base, '{id}', '"8f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"');
  r := intake.submit_public_case(v_base || jsonb_build_object('form', v_form, 'invalid', 'title'));
  if r <> 'rejected_validation' then raise exception 'FAIL: invalid z process -> %', r; end if;
  for i in 1..3 loop
    v_base := jsonb_set(v_base, '{id}', to_jsonb(format('9f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5%s', i)));
    r := intake.submit_public_case(v_base || jsonb_build_object('form', v_form));
    if r <> 'inserted' then raise exception 'FAIL: zgłoszenie % -> %', i, r; end if;
  end loop;
  v_base := jsonb_set(v_base, '{id}', '"af1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"');
  r := intake.submit_public_case(v_base || jsonb_build_object('form', v_form));
  if r <> 'rejected_ratelimit' then raise exception 'FAIL: limit godzinowy -> %', r; end if;
  begin
    perform count(*) from public.cases;
    raise exception 'FAIL: legatto_intake czyta cases';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.cases where source = 'public_form' and public_ref = 'abcdef01'
        and consent_contacts_db and submission_ip_hash = repeat('b', 64)) <> 3 then
    raise exception 'FAIL: sprawy z formularza';
  end if;
end $$;
rollback;

select 'LEGATTO FEATURE TESTS: PASS' as result;

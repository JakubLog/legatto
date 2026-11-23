-- compat-n-1: safe
-- Legatto (A6, A8): statyczna strona posła - kolejka publikacji, migawka danych publicznych,
-- publikacja wersji online newslettera przed wysyłką.
--
-- Przepływ (VPS):
--   CRM (Poseł/Administrator, aal2)  -> request_site_publish('manual')            -> site_publish_jobs (queued)
--   newsletter (writer, aal2)        -> request_newsletter_publication(issue)      -> job 'newsletter'
--   legatto-site-publish (host timer, rola DB legatto_publisher, obraz app: node /app/server/site.mjs)
--     claim  -> service_site_publisher_claim()   (queued -> running; dzienny job 'daily' po 03:30)
--     snapshot -> service_site_snapshot()        (jsonb ze wszystkimi danymi strony)
--     build (bez sieci) + wrangler pages deploy
--     finish -> service_site_publisher_finish()  (ok|failed; ok oznacza newslettery jako opublikowane)
--   getresponse-proxy wysyła newsletter dopiero, gdy web_published_at jest ustawione (A8),
--   o ile app_settings.public_site_url jest niepusty (tryb strony statycznej).
--
-- Tryb Vercel (do końca migracji instancji): api/public-site zwraca tę samą migawkę kluczem
-- service_role, a SPA renderuje z niej stronę główną (anon traci dostęp do get_public_* w etapie
-- contract - zob. supabase/migrations-contract/revoke_anon_public.sql).

-- ============================================================================
-- 1. Rola bazy dla publishera (hasło ustawia rola Ansible site_publisher: ALTER ROLE)
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'legatto_publisher') then
    create role legatto_publisher login noinherit nocreatedb nocreaterole noreplication;
  end if;
end $$;

comment on role legatto_publisher is
  'Legatto self-host: generator strony (legatto-site-publish). EXECUTE tylko na service_site_*.';

-- ============================================================================
-- 2. Ustawienie public_site_url (adres strony posła, np. https://jan-kowalski.pl)
-- ============================================================================
-- Pusty = brak strony statycznej (tryb Vercel: wersja online newslettera pod originem portalu).
insert into public.app_settings (key, value)
values ('public_site_url', '""'::jsonb)
on conflict (key) do nothing;

create or replace function public.public_site_url()
returns text
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select coalesce(
    (select case
              when jsonb_typeof(s.value) = 'string'
               and (s.value #>> '{}') ~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$'
              then s.value #>> '{}'
            end
       from public.app_settings s where s.key = 'public_site_url'),
    ''
  )
$$;

comment on function public.public_site_url() is
  'Origin strony posła z app_settings.public_site_url (tylko https://host[:port]) albo pusty tekst.';

revoke all on function public.public_site_url() from public, anon;
grant execute on function public.public_site_url() to authenticated, service_role;

-- Walidacja zapisu: tylko origin https (bez ścieżki) albo pusty.
create or replace function public.app_settings_public_site_url_check()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.key = 'public_site_url'
     and not (jsonb_typeof(new.value) = 'string'
              and ((new.value #>> '{}') = '' or (new.value #>> '{}') ~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$')) then
    raise exception 'public_site_url: wymagany adres https://domena (bez ścieżki) albo pusty'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.app_settings_public_site_url_check() from public, anon, authenticated;

drop trigger if exists app_settings_public_site_url_check on public.app_settings;
create trigger app_settings_public_site_url_check
before insert or update on public.app_settings
for each row execute function public.app_settings_public_site_url_check();

-- ============================================================================
-- 3. Newsletter: publikacja wersji online przed wysyłką
-- ============================================================================
alter table public.newsletter_issues
  add column if not exists web_publish_requested_at timestamptz,
  add column if not exists web_published_at timestamptz;

comment on column public.newsletter_issues.web_publish_requested_at is
  'Wydanie zgłoszone do publikacji na stronie posła (/n/<slug>); od tej chwili treść jest zamrożona.';
comment on column public.newsletter_issues.web_published_at is
  'Wersja online jest na stronie posła (job publikacji zakończony ok) - warunek wysyłki przy public_site_url.';

-- Zgłoszone do publikacji wydanie jest zamrożone dla klientów (to, co wyślemy, = to, co opublikowano).
create or replace function public.newsletter_issues_freeze_published()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  if old.web_publish_requested_at is not null
     and (new.html_web is distinct from old.html_web
          or new.template is distinct from old.template
          or new.subject is distinct from old.subject) then
    raise exception 'Wydanie zostało zgłoszone do publikacji na stronie - utwórz nowe wydanie (Duplikuj)'
      using errcode = '42501';
  end if;
  if new.web_publish_requested_at is distinct from old.web_publish_requested_at
     or new.web_published_at is distinct from old.web_published_at then
    raise exception 'Stan publikacji ustawia tylko serwer' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.newsletter_issues_freeze_published() from public, anon, authenticated;

drop trigger if exists newsletter_issues_freeze_published on public.newsletter_issues;
create trigger newsletter_issues_freeze_published
before update on public.newsletter_issues
for each row execute function public.newsletter_issues_freeze_published();

-- ============================================================================
-- 4. Kolejka publikacji
-- ============================================================================
create table if not exists public.site_publish_jobs (
  id             uuid        primary key default gen_random_uuid(),
  reason         text        not null
    constraint site_publish_jobs_reason_check check (reason in ('manual', 'newsletter', 'daily')),
  status         text        not null default 'queued'
    constraint site_publish_jobs_status_check check (status in ('queued', 'running', 'ok', 'failed')),
  requested_by   uuid        references public.profiles(id) on delete set null,
  requested_at   timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  deployment_id  text
    constraint site_publish_jobs_deployment_check check (deployment_id is null or deployment_id ~ '^[A-Za-z0-9._-]{1,128}$'),
  error          text
    constraint site_publish_jobs_error_check check (error is null or error ~ '^[a-z0-9_.:-]{1,64}$')
);

comment on table public.site_publish_jobs is
  'Kolejka publikacji strony posła. Zapis tylko przez request_site_publish / service_site_publisher_*.';

create index if not exists site_publish_jobs_status_idx on public.site_publish_jobs (status, requested_at);
create index if not exists site_publish_jobs_finished_idx on public.site_publish_jobs (finished_at desc);

alter table public.site_publish_jobs enable row level security;
revoke all on public.site_publish_jobs from public, anon, authenticated;
grant select on public.site_publish_jobs to authenticated;
grant all on public.site_publish_jobs to service_role;

drop policy if exists site_publish_jobs_select_writer on public.site_publish_jobs;
create policy site_publish_jobs_select_writer on public.site_publish_jobs for select to authenticated
  using (public.is_writer() and public.is_aal2());

-- Jeden oczekujący job wystarcza: kolejne żądania dołączają do niego.
create or replace function public.enqueue_site_publish(p_reason text, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('site_publish_enqueue', 0));
  select j.id into v_id from public.site_publish_jobs j where j.status = 'queued'
   order by j.requested_at limit 1;
  if v_id is null then
    insert into public.site_publish_jobs (reason, requested_by) values (p_reason, p_user)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.enqueue_site_publish(text, uuid) from public, anon, authenticated;

create or replace function public.request_site_publish()
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_id uuid;
begin
  if not (public.is_posel() and public.is_aal2()) then
    raise exception 'Brak uprawnień (Poseł/Administrator z 2FA)' using errcode = '42501';
  end if;
  v_id := public.enqueue_site_publish('manual', auth.uid());
  perform public.log_audit('site.publish_request', 'site_publish_job', v_id, jsonb_build_object('reason', 'manual'));
  return v_id;
end;
$$;

revoke all on function public.request_site_publish() from public, anon;
grant execute on function public.request_site_publish() to authenticated;

create or replace function public.request_newsletter_publication(p_issue_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_issue public.newsletter_issues;
  v_id uuid;
begin
  if not (public.is_writer() and public.is_aal2()) then
    raise exception 'Brak uprawnień' using errcode = '42501';
  end if;
  if public.public_site_url() = '' then
    raise exception 'Brak adresu strony posła (Ustawienia: public_site_url)' using errcode = '22023';
  end if;
  select * into v_issue from public.newsletter_issues where id = p_issue_id for update;
  if not found then
    raise exception 'Nie znaleziono wydania' using errcode = 'P0002';
  end if;
  if v_issue.status <> 'draft' then
    raise exception 'Wydanie zostało już wysłane' using errcode = '22023';
  end if;
  if v_issue.web_publish_requested_at is null then
    update public.newsletter_issues set web_publish_requested_at = now() where id = p_issue_id;
  end if;
  if v_issue.web_published_at is not null then
    -- Już opublikowane: zwracamy ostatni udany job (klient od razu może wysyłać).
    select j.id into v_id from public.site_publish_jobs j where j.status = 'ok'
     order by j.finished_at desc limit 1;
    return v_id;
  end if;
  v_id := public.enqueue_site_publish('newsletter', auth.uid());
  perform public.log_audit('newsletter.publish_request', 'newsletter_issue', p_issue_id,
    jsonb_build_object('job_id', v_id));
  return v_id;
end;
$$;

revoke all on function public.request_newsletter_publication(uuid) from public, anon;
grant execute on function public.request_newsletter_publication(uuid) to authenticated;

-- Publisher: zajęcie joba. Zwraca (id, reason) albo zero wierszy.
-- Job 'running' starszy niż 30 min = przerwany (timeout). Codzienna przebudowa (minione
-- wydarzenia znikają z kalendarza): po 03:30 czasu Europe/Warsaw, jeśli tego dnia nie było
-- udanej publikacji i strona była już kiedyś opublikowana ręcznie.
create or replace function public.service_site_publisher_claim()
returns table (job_id uuid, reason text)
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
#variable_conflict use_column
declare
  v_today_cutoff timestamptz :=
    ((now() at time zone 'Europe/Warsaw')::date + time '03:30') at time zone 'Europe/Warsaw';
  v_job public.site_publish_jobs;
begin
  perform pg_advisory_xact_lock(hashtextextended('site_publish_enqueue', 0));

  update public.site_publish_jobs
     set status = 'failed', finished_at = now(), error = 'timeout'
   where status = 'running' and started_at < now() - interval '30 minutes';

  if exists (select 1 from public.site_publish_jobs where status = 'running') then
    return;
  end if;

  if not exists (select 1 from public.site_publish_jobs where status = 'queued')
     and now() >= v_today_cutoff
     and exists (select 1 from public.site_publish_jobs where status = 'ok' and reason = 'manual')
     and not exists (
       select 1 from public.site_publish_jobs
        where (status = 'ok' and finished_at >= v_today_cutoff)
           or (reason = 'daily' and requested_at >= v_today_cutoff)
     ) then
    insert into public.site_publish_jobs (reason) values ('daily');
  end if;

  update public.site_publish_jobs j
     set status = 'running', started_at = now()
   where j.id = (select q.id from public.site_publish_jobs q where q.status = 'queued'
                  order by q.requested_at limit 1 for update skip locked)
  returning * into v_job;

  if v_job.id is null then
    return;
  end if;
  job_id := v_job.id;
  reason := v_job.reason;
  return next;
end;
$$;

create or replace function public.service_site_publisher_finish(
  p_job_id uuid,
  p_status text,
  p_deployment_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_job public.site_publish_jobs;
  v_published integer := 0;
begin
  if p_status not in ('ok', 'failed') then
    raise exception 'p_status: ok|failed' using errcode = '22023';
  end if;
  select * into v_job from public.site_publish_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'running' then
    raise exception 'Job nie jest w toku' using errcode = '22023';
  end if;

  update public.site_publish_jobs
     set status = p_status, finished_at = now(), deployment_id = p_deployment_id,
         error = case when p_status = 'failed' then coalesce(p_error, 'failed') end
   where id = p_job_id;

  if p_status = 'ok' then
    -- Migawka powstała po started_at, więc zawiera wydania zgłoszone przed nim.
    update public.newsletter_issues
       set web_published_at = now()
     where web_publish_requested_at is not null
       and web_publish_requested_at <= v_job.started_at
       and web_published_at is null;
    get diagnostics v_published = row_count;
  end if;

  perform public.service_log_audit(null, 'site.publish_' || p_status, 'site_publish_job', p_job_id,
    jsonb_build_object('reason', v_job.reason, 'deployment_id', p_deployment_id, 'error', p_error,
                       'newsletters_published', v_published));
end;
$$;

-- ============================================================================
-- 5. Migawka danych publicznych
-- ============================================================================
-- Jedyne źródło treści strony posła (site/) i strony głównej SPA w trybie Vercel.
-- Zawiera wyłącznie dane przeznaczone do publikacji. Zasoby (zdjęcia) to referencje do
-- publicznych bucketów; generator pobiera je i przepisuje na /assets/<sha256>.<ext>.
create or replace function public.service_site_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  with
  offices as (
    select o.id, o.name, o.city, o.address, o.phone, o.email, o.is_main
      from public.offices o
     where o.is_active = true
     order by o.is_main desc, o.city asc
  ),
  staff as (
    select p.id, p.office_id, p.full_name, p.role, p.phone, p.avatar_url
      from public.profiles p
      join public.offices o on o.id = p.office_id and o.is_active = true
     where p.is_active = true and p.is_public = true
     order by case p.role when 'posel' then 1 when 'administrator' then 2 when 'pracownik' then 3 else 4 end,
              p.full_name
  ),
  events as (
    select e.id, e.title, e.description, e.type, e.starts_at, e.ends_at, e.all_day, e.location,
           pw.name as powiat_name, gm.name as gmina_name
      from public.events e
      left join public.powiaty pw on pw.id = e.powiat_id
      left join public.gminy gm on gm.id = e.gmina_id
     where e.is_public = true
       and e.starts_at >= now() - interval '6 hours'
     order by e.starts_at asc
     limit 24
  ),
  posts as (
    select p.slug, p.title, p.excerpt, p.body_md, p.cover_path, p.published_at, p.updated_at
      from public.posts p
     where p.status = 'published' and p.published_at <= now()
     order by p.published_at desc
  ),
  newsletters as (
    select n.slug, n.subject, n.html_web, coalesce(n.sent_at, n.web_publish_requested_at) as published_at
      from public.newsletter_issues n
     where n.status = 'sent' or n.web_publish_requested_at is not null
     order by coalesce(n.sent_at, n.web_publish_requested_at) desc
  ),
  newsletter_assets as (
    select distinct on (m.sha) m.sha as sha256, m.ext, o.name as path
      from newsletters n
      cross join lateral regexp_matches(n.html_web, '/n/a/([0-9a-f]{64})\.(png|jpg|webp|gif)', 'g') as r(x)
      cross join lateral (select r.x[1] as sha, r.x[2] as ext) m
      join storage.objects o
        on o.bucket_id = 'newsletter-assets'
       and o.name like '%/' || m.sha || '.' || m.ext
     order by m.sha, o.created_at
  )
  select jsonb_build_object(
    'schema_version', 1,
    'generated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'public_site_url', public.public_site_url(),
    'identity', coalesce((select s.value from public.app_settings s where s.key = 'site_identity'), '{}'::jsonb),
    'homepage', coalesce((select s.value from public.app_settings s where s.key = 'homepage'), '{}'::jsonb),
    'district', public.get_public_district(),
    'offices', coalesce((select jsonb_agg(to_jsonb(o)) from offices o), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(to_jsonb(s)) from staff s), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e)) from events e), '[]'::jsonb),
    'dictionaries', jsonb_build_object(
      'powiaty', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'is_city', p.is_city,
                                                               'lat', p.lat, 'lng', p.lng) order by p.name)
                             from public.powiaty p), '[]'::jsonb),
      'gminy', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'powiat_id', g.powiat_id, 'name', g.name,
                                                             'type', g.type) order by g.name)
                           from public.gminy g), '[]'::jsonb),
      'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug,
                                                                  'color', c.color) order by c.name)
                                from public.case_categories c where c.is_system = true), '[]'::jsonb)
    ),
    'posts', coalesce((select jsonb_agg(to_jsonb(p)) from posts p), '[]'::jsonb),
    'newsletters', coalesce((select jsonb_agg(to_jsonb(n)) from newsletters n), '[]'::jsonb),
    'newsletter_assets', coalesce((select jsonb_agg(to_jsonb(a)) from newsletter_assets a), '[]'::jsonb)
  )
$$;

comment on function public.service_site_snapshot() is
  'Migawka danych strony posła (schema_version 1). Tylko service_role i legatto_publisher.';

revoke all on function public.service_site_publisher_claim() from public, anon, authenticated;
revoke all on function public.service_site_publisher_finish(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.service_site_snapshot() from public, anon, authenticated;
grant execute on function public.service_site_publisher_claim() to service_role, legatto_publisher;
grant execute on function public.service_site_publisher_finish(uuid, text, text, text) to service_role, legatto_publisher;
grant execute on function public.service_site_snapshot() to service_role, legatto_publisher;

-- Stan publikacji dla panelu (ostatni job i oczekujące) - bez danych osobowych.
create or replace function public.get_site_publish_status()
returns jsonb
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select case when not (public.is_writer() and public.is_aal2()) then null else jsonb_build_object(
    'public_site_url', public.public_site_url(),
    'last', (select to_jsonb(j) - 'requested_by' from public.site_publish_jobs j
              where j.status in ('ok', 'failed') order by j.finished_at desc limit 1),
    'last_ok_at', (select max(j.finished_at) from public.site_publish_jobs j where j.status = 'ok'),
    'pending', (select coalesce(jsonb_agg(to_jsonb(j) - 'requested_by' order by j.requested_at), '[]'::jsonb)
                  from public.site_publish_jobs j where j.status in ('queued', 'running'))
  ) end
$$;

revoke all on function public.get_site_publish_status() from public, anon;
grant execute on function public.get_site_publish_status() to authenticated;

-- Retencja historii jobów (90 dni).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('site-publish-jobs-retention', '20 3 * * *',
      $job$delete from public.site_publish_jobs where finished_at < now() - interval '90 days'$job$);
  end if;
end $$;

-- Powiadomienia: e-mail (Resend) i web push (PWA).
--
-- Model:
--   - Zdarzenia w bazie (triggery na sprawach, wydarzeniach, interpelacjach, tokenach MCP, źródłach
--     ICS i wybranych wpisach audit_log) oraz codzienny cron wstawiają wiersze do kolejki
--     `notification_outbox` przez `notify()`. `notify()` sprawdza preferencje odbiorcy
--     (`notification_preferences`, domyślne w `notification_catalog()`) i nie wstawia nic, gdy
--     żaden kanał nie jest wybrany.
--   - Wysyłkę robi serwer (`api/notifications.ts`, service_role): odbiera kolejkę przez
--     `notifications_claim()` (skip locked), renderuje treść, wysyła e-mail przez Resend i push
--     (VAPID) na urządzenia z `push_subscriptions`.
--   - Natychmiastowość: po wstawieniu wierszy trigger woła `net.http_post` (pg_net) na adres
--     zarejestrowany przez serwer w `notification_server_config`. Bez pg_net albo bez rejestracji
--     kolejkę opróżnia codzienny cron.
--   - Klucz Resend: sekret `resend_api_key` w app_settings (jak klucze AI/GetResponse: zapis
--     `set_secret_setting`, status `get_secret_settings_status`, niewidoczny dla authenticated).
--     Ustawienia instancji (nadawca, adres portalu, przełączniki) w `app_settings.notifications_settings`
--     zapisuje serwer po walidacji.
--   - Treść kolejki (tytuły spraw) i klucze VAPID/tokeny dispatchu nie są dostępne dla klienta.

create extension if not exists pg_net;

-- ============================================================================
-- 1. Katalog rodzajów powiadomień (zgodny z src/lib/notifications.ts)
-- ============================================================================

create or replace function public.notification_catalog()
returns table (kind text, admin_only boolean, email_default boolean, push_default boolean, admin_default_only boolean)
language sql
immutable
set search_path = public
as $$
  values
    ('security_integration',    false, true,  true,  false),
    ('security_account',        false, true,  true,  false),
    ('case_assigned',           false, true,  true,  false),
    ('case_deadline',           false, true,  false, false),
    ('public_submission',       false, true,  true,  true),
    ('event_assigned',          false, true,  true,  false),
    ('interpellation_review',   true,  true,  true,  false),
    ('interpellation_decision', false, true,  true,  false),
    ('responsibility',          false, true,  true,  false),
    ('weekly_digest',           false, true,  false, false),
    ('daily_digest',            false, false, false, false)
$$;

revoke all on function public.notification_catalog() from public, anon, authenticated;

-- ============================================================================
-- 2. Tabele
-- ============================================================================

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email_enabled boolean not null default true,
  push_enabled boolean not null default true,
  kinds jsonb not null default '{}'::jsonb check (jsonb_typeof(kinds) = 'object'),
  weekly_digest_day smallint not null default 1 check (weekly_digest_day between 1 and 7),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public, anon, authenticated;
grant all on public.notification_preferences to service_role;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (
    char_length(endpoint) <= 1000
    and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/'
  ),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count smallint not null default 0
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select (id, endpoint, user_agent, created_at, last_success_at) on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
on public.push_subscriptions for select
to authenticated
using (user_id = auth.uid() and public.is_authenticated_active() and public.is_aal2());

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  want_email boolean not null,
  want_push boolean not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  email_status text check (email_status in ('sent', 'failed', 'skipped')),
  push_status text check (push_status in ('sent', 'failed', 'skipped')),
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  email_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, kind, dedupe_key)
);

create index if not exists notification_outbox_queue_idx
  on public.notification_outbox (next_attempt_at)
  where status in ('pending', 'sending');
create index if not exists notification_outbox_created_idx on public.notification_outbox (created_at desc);

alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from public, anon, authenticated;
grant all on public.notification_outbox to service_role;

-- Konfiguracja serwera (jeden wiersz): adres i token wywołania wysyłki, klucze VAPID.
-- Tylko service_role (RLS bez polityk, brak grantów dla klienta).
create table if not exists public.notification_server_config (
  id boolean primary key default true check (id),
  dispatch_url text check (dispatch_url ~ '^https?://'),
  dispatch_token text check (char_length(dispatch_token) >= 32),
  vapid_public_key text,
  vapid_private_key text,
  updated_at timestamptz not null default now()
);

alter table public.notification_server_config enable row level security;
revoke all on public.notification_server_config from public, anon, authenticated;
grant all on public.notification_server_config to service_role;

-- ============================================================================
-- 3. Preferencje i kolejka
-- ============================================================================

-- Czy użytkownik chce dany rodzaj w danym kanale (preferencje albo domyślne z katalogu).
-- NULL = rodzaj niedostępny dla roli / nieznany / konto nieaktywne.
create or replace function public.notification_wants(p_user_id uuid, p_kind text, p_channel text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select case
    when c.admin_only and p.role not in ('posel', 'administrator') then null
    else
      (case p_channel when 'email' then coalesce(np.email_enabled, true) else coalesce(np.push_enabled, true) end)
      and coalesce(
        (np.kinds -> p_kind ->> p_channel)::boolean,
        case
          when c.admin_default_only and p.role not in ('posel', 'administrator') then false
          when p_channel = 'email' then c.email_default
          else c.push_default
        end
      )
  end
  from public.profiles p
  join public.notification_catalog() c on c.kind = p_kind
  left join public.notification_preferences np on np.user_id = p.id
  where p.id = p_user_id
    and p.is_active = true
    and p_channel in ('email', 'push')
$$;

revoke all on function public.notification_wants(uuid, text, text) from public, anon, authenticated;

-- Wstawia powiadomienie do kolejki, jeśli odbiorca chce choć jeden kanał. true = wstawiono.
-- Push liczy się tylko przy zarejestrowanym urządzeniu. Ten sam dedupe_key = bez duplikatu.
create or replace function public.notify(p_user_id uuid, p_kind text, p_payload jsonb, p_dedupe_key text default null)
returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_email boolean;
  v_push boolean;
  v_rows integer;
begin
  if p_user_id is null then
    return false;
  end if;
  v_email := coalesce(public.notification_wants(p_user_id, p_kind, 'email'), false);
  v_push := coalesce(public.notification_wants(p_user_id, p_kind, 'push'), false)
    and exists (select 1 from public.push_subscriptions s where s.user_id = p_user_id);
  if not (v_email or v_push) then
    return false;
  end if;

  insert into public.notification_outbox (user_id, kind, payload, dedupe_key, want_email, want_push)
  values (p_user_id, p_kind, coalesce(p_payload, '{}'::jsonb), p_dedupe_key, v_email, v_push)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.notify(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.notify(uuid, text, jsonb, text) to service_role;

-- Imię i nazwisko aktora zdarzenia (NULL dla service_role/MCP bez sesji).
create or replace function public.notification_actor_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select nullif(btrim(full_name), '') from public.profiles where id = p_user_id
$$;

revoke all on function public.notification_actor_name(uuid) from public, anon, authenticated;

-- Moje preferencje: wartości efektywne dla rodzajów dostępnych w mojej roli.
create or replace function public.get_my_notification_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null or not public.is_authenticated_active() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'email_enabled', coalesce(np.email_enabled, true),
    'push_enabled', coalesce(np.push_enabled, true),
    'weekly_digest_day', coalesce(np.weekly_digest_day, 1),
    'kinds', (
      select coalesce(jsonb_object_agg(c.kind, jsonb_build_object(
        'email', coalesce((np.kinds -> c.kind ->> 'email')::boolean,
          case when c.admin_default_only and p.role not in ('posel', 'administrator') then false else c.email_default end),
        'push', coalesce((np.kinds -> c.kind ->> 'push')::boolean,
          case when c.admin_default_only and p.role not in ('posel', 'administrator') then false else c.push_default end)
      )), '{}'::jsonb)
      from public.notification_catalog() c
      where not c.admin_only or p.role in ('posel', 'administrator')
    )
  )
  into v_result
  from public.profiles p
  left join public.notification_preferences np on np.user_id = p.id
  where p.id = v_user_id;

  return v_result;
end;
$$;

revoke all on function public.get_my_notification_preferences() from public, anon;
grant execute on function public.get_my_notification_preferences() to authenticated;

-- Zapis moich preferencji. NULL = bez zmian; p_kinds częściowy: { kind: { email?, push? } }.
create or replace function public.set_my_notification_preferences(
  p_email_enabled boolean,
  p_push_enabled boolean,
  p_weekly_digest_day integer,
  p_kinds jsonb
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role;
  v_kinds jsonb;
  v_kind text;
  v_value jsonb;
  v_channel text;
begin
  if v_user_id is null or not public.is_authenticated_active() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;
  if p_weekly_digest_day is not null and p_weekly_digest_day not between 1 and 7 then
    raise exception 'Dzień podsumowania tygodnia: 1-7' using errcode = '22023';
  end if;
  if p_kinds is not null and jsonb_typeof(p_kinds) <> 'object' then
    raise exception 'Rodzaje powiadomień muszą być obiektem' using errcode = '22023';
  end if;

  select role into v_role from public.profiles where id = v_user_id;

  insert into public.notification_preferences (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select kinds into v_kinds from public.notification_preferences where user_id = v_user_id for update;

  for v_kind, v_value in select key, value from jsonb_each(coalesce(p_kinds, '{}'::jsonb)) loop
    if not exists (
      select 1 from public.notification_catalog() c
      where c.kind = v_kind and (not c.admin_only or v_role in ('posel', 'administrator'))
    ) then
      raise exception 'Nieznany rodzaj powiadomienia: %', v_kind using errcode = '22023';
    end if;
    if jsonb_typeof(v_value) <> 'object' then
      raise exception 'Ustawienie % musi być obiektem { email, push }', v_kind using errcode = '22023';
    end if;
    for v_channel in select jsonb_object_keys(v_value) loop
      if v_channel not in ('email', 'push') or jsonb_typeof(v_value -> v_channel) <> 'boolean' then
        raise exception 'Ustawienie %.%: dozwolone email/push typu boolean', v_kind, v_channel using errcode = '22023';
      end if;
    end loop;
    v_kinds := jsonb_set(v_kinds, array[v_kind], coalesce(v_kinds -> v_kind, '{}'::jsonb) || v_value);
  end loop;

  update public.notification_preferences
     set email_enabled = coalesce(p_email_enabled, email_enabled),
         push_enabled = coalesce(p_push_enabled, push_enabled),
         weekly_digest_day = coalesce(p_weekly_digest_day, weekly_digest_day),
         kinds = v_kinds,
         updated_at = now()
   where user_id = v_user_id;
end;
$$;

revoke all on function public.set_my_notification_preferences(boolean, boolean, integer, jsonb) from public, anon;
grant execute on function public.set_my_notification_preferences(boolean, boolean, integer, jsonb) to authenticated;

-- Rejestracja urządzenia push. Ten sam endpoint u innego konta (wspólne urządzenie) przechodzi
-- na bieżące konto. Najwyżej 20 urządzeń na konto (najstarsze usuwane).
create or replace function public.register_my_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
begin
  if v_user_id is null or not public.is_authenticated_active() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    values (v_user_id, btrim(p_endpoint), btrim(p_p256dh), btrim(p_auth), left(nullif(btrim(p_user_agent), ''), 300))
    on conflict (endpoint) do update
      set user_id = excluded.user_id,
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          user_agent = excluded.user_agent,
          failure_count = 0
    returning id into v_id;
  exception when check_violation or not_null_violation then
    raise exception 'Nieobsługiwana usługa powiadomień push' using errcode = '22023';
  end;

  delete from public.push_subscriptions
   where user_id = v_user_id
     and id not in (
       select id from public.push_subscriptions
        where user_id = v_user_id
        order by created_at desc
        limit 20
     );

  return v_id;
end;
$$;

revoke all on function public.register_my_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_my_push_subscription(text, text, text, text) to authenticated;

create or replace function public.remove_my_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  -- Bez wymogu aal2: wylogowanie z wygasającą sesją ma móc odpiąć urządzenie.
  delete from public.push_subscriptions where user_id = auth.uid() and endpoint = btrim(p_endpoint);
end;
$$;

revoke all on function public.remove_my_push_subscription(text) from public, anon;
grant execute on function public.remove_my_push_subscription(text) to authenticated;

-- Odbiór paczki do wysyłki (serwer). Wiersze 'sending' z wygasłą blokadą wracają do obiegu.
create or replace function public.notifications_claim(p_limit integer)
returns setof public.notification_outbox
language sql
security definer
set search_path = public
set row_security = off
as $$
  update public.notification_outbox o
     set status = 'sending',
         locked_until = now() + interval '3 minutes',
         attempts = o.attempts + 1
   where o.id in (
     select q.id from public.notification_outbox q
      where (q.status = 'pending' and q.next_attempt_at <= now())
         or (q.status = 'sending' and q.locked_until < now())
      order by q.created_at
      limit greatest(1, least(coalesce(p_limit, 20), 100))
      for update skip locked
   )
  returning o.*
$$;

revoke all on function public.notifications_claim(integer) from public, anon, authenticated;
grant execute on function public.notifications_claim(integer) to service_role;

-- Historia wysyłek dla administracji (bez treści powiadomień).
create or replace function public.get_notification_deliveries(p_limit integer default 50)
returns table (
  id uuid,
  created_at timestamptz,
  kind text,
  user_id uuid,
  user_name text,
  status text,
  email_status text,
  push_status text,
  attempts integer,
  last_error text,
  sent_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  if not public.is_posel() then
    raise exception 'Brak uprawnien (wymagana rola: posel lub administrator)' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  return query
  select o.id, o.created_at, o.kind, o.user_id, p.full_name, o.status, o.email_status, o.push_status,
         o.attempts::integer, o.last_error, o.sent_at
    from public.notification_outbox o
    left join public.profiles p on p.id = o.user_id
   order by o.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function public.get_notification_deliveries(integer) from public, anon;
grant execute on function public.get_notification_deliveries(integer) to authenticated;

-- Stan wysyłki dla panelu administracji (serwer; bez treści powiadomień).
create or replace function public.notifications_admin_overview()
returns jsonb
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select jsonb_build_object(
    'pg_net', exists (select 1 from pg_extension where extname = 'pg_net'),
    'dispatch_registered', exists (
      select 1 from public.notification_server_config
       where id and dispatch_url is not null and dispatch_token is not null),
    'pending', (select count(*) from public.notification_outbox where status in ('pending', 'sending')),
    'failed_24h', (select count(*) from public.notification_outbox
                    where status = 'failed' and created_at > now() - interval '24 hours'),
    'sent_7d', (select count(*) from public.notification_outbox
                 where status = 'sent' and created_at > now() - interval '7 days')
  )
$$;

revoke all on function public.notifications_admin_overview() from public, anon, authenticated;
grant execute on function public.notifications_admin_overview() to service_role;

-- ============================================================================
-- 4. Natychmiastowa wysyłka: pg_net → api/notifications?op=dispatch
-- ============================================================================

create or replace function public.notifications_kick()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_url text;
  v_token text;
begin
  if coalesce(current_setting('notifications.no_kick', true), '') = 'on' then
    return null;
  end if;
  -- Tylko wiersze do zwykłej kolejki (test wysyła serwer od razu, ze statusem 'sending').
  if not exists (select 1 from inserted where status = 'pending') then
    return null;
  end if;
  select dispatch_url, dispatch_token into v_url, v_token
    from public.notification_server_config where id;
  if v_url is null or v_token is null or not exists (select 1 from pg_extension where extname = 'pg_net') then
    return null;
  end if;
  begin
    -- Dynamiczny SQL: funkcja kompiluje się także bez pg_net.
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 30000)'
      using v_url, '{}'::jsonb,
        jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json');
  exception when others then
    raise warning 'notifications_kick: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.notifications_kick() from public, anon, authenticated;

drop trigger if exists notification_outbox_kick on public.notification_outbox;
create trigger notification_outbox_kick
after insert on public.notification_outbox
referencing new table as inserted
for each statement execute function public.notifications_kick();

-- ============================================================================
-- 5. Źródła zdarzeń. Błąd powiadomień nigdy nie przerywa operacji biznesowej.
-- ============================================================================

-- Sprawy: przypisanie i nowe zgłoszenie z formularza publicznego.
create or replace function public.notifications_cases_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text := public.notification_actor_name(auth.uid());
begin
  begin
    if new.assigned_to is not null
       and new.assigned_to is distinct from v_actor
       and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
       and new.status not in ('załatwiona', 'odrzucona') then
      perform public.notify(new.assigned_to, 'case_assigned', jsonb_build_object(
        'case_id', new.id, 'title', new.title, 'due_date', new.due_date,
        'priority', new.priority, 'actor', v_actor_name));
    end if;

    if tg_op = 'INSERT' and new.source = 'public_form' then
      perform public.notify(p.id, 'public_submission',
        jsonb_build_object('case_id', new.id, 'title', new.title), 'case:' || new.id)
        from public.profiles p
       where p.is_active = true
         and (p.role in ('posel', 'administrator') or p.scope_cases = 'all');
    end if;
  exception when others then
    raise warning 'notifications_cases_trigger: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.notifications_cases_trigger() from public, anon, authenticated;

drop trigger if exists cases_notifications on public.cases;
create trigger cases_notifications
after insert or update of assigned_to on public.cases
for each row execute function public.notifications_cases_trigger();

-- Wydarzenia: przypisanie.
create or replace function public.notifications_events_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
begin
  begin
    if new.assigned_to is not null
       and new.assigned_to is distinct from v_actor
       and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
       and new.starts_at >= now() - interval '1 day' then
      perform public.notify(new.assigned_to, 'event_assigned', jsonb_build_object(
        'event_id', new.id, 'title', new.title, 'starts_at', new.starts_at, 'all_day', new.all_day,
        'actor', public.notification_actor_name(v_actor)));
    end if;
  exception when others then
    raise warning 'notifications_events_trigger: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.notifications_events_trigger() from public, anon, authenticated;

drop trigger if exists events_notifications on public.events;
create trigger events_notifications
after insert or update of assigned_to on public.events
for each row execute function public.notifications_events_trigger();

-- Interpelacje: do decyzji (nowa / po poprawkach) i decyzja (uwagi / zaakceptowana / odrzucona).
create or replace function public.notifications_interpellations_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_payload jsonb;
begin
  begin
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
      return null;
    end if;
    v_payload := jsonb_build_object(
      'interpellation_id', new.id, 'subject', new.subject, 'status', new.status,
      'revision', new.revision, 'actor', public.notification_actor_name(v_actor));

    if new.status in ('nowa', 'po_poprawkach') then
      -- Sygnatariusz z rolą Posła/administratora decyduje; inaczej wszyscy z tą rolą.
      perform public.notify(r.id, 'interpellation_review', v_payload,
        'review:' || new.id || ':' || coalesce(new.revision, 0))
        from public.profiles r
       where r.is_active = true
         and r.role in ('posel', 'administrator')
         and r.id is distinct from v_actor
         and (
           r.id = new.signatory_id
           or not exists (
             select 1 from public.profiles s
              where s.id = new.signatory_id and s.is_active and s.role in ('posel', 'administrator')
           )
         );
    elsif tg_op = 'UPDATE' and new.status in ('uwagi', 'zaakceptowana', 'odrzucona') then
      v_payload := v_payload || jsonb_build_object('review_notes', left(new.review_notes, 600));
      perform public.notify(u.user_id, 'interpellation_decision', v_payload,
        'decision:' || new.id || ':' || coalesce(new.revision, 0) || ':' || new.status)
        from (select distinct x as user_id from unnest(array[new.created_by, new.signatory_id]) as t(x)) u
       where u.user_id is not null and u.user_id is distinct from v_actor;
    end if;
  exception when others then
    raise warning 'notifications_interpellations_trigger: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.notifications_interpellations_trigger() from public, anon, authenticated;

drop trigger if exists interpellations_notifications on public.interpellations;
create trigger interpellations_notifications
after insert or update of status on public.interpellations
for each row execute function public.notifications_interpellations_trigger();

-- Nowy token MCP (ręczny albo wydany aplikacji OAuth, np. Claude) i nowe źródło ICS.
create or replace function public.notifications_integration_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  begin
    if tg_table_name = 'mcp_tokens' then
      perform public.notify(new.user_id, 'security_integration', jsonb_build_object(
        'service', case when new.oauth_client_id is not null then 'oauth' else 'mcp' end,
        'name', coalesce((select c.name from public.oauth_clients c where c.client_id = new.oauth_client_id), new.name),
        'at', now()));
    elsif tg_table_name = 'ics_sources' then
      perform public.notify(new.created_by, 'security_integration', jsonb_build_object(
        'service', 'ics', 'name', new.name, 'at', now()));
    end if;
  exception when others then
    raise warning 'notifications_integration_trigger: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.notifications_integration_trigger() from public, anon, authenticated;

drop trigger if exists mcp_tokens_notifications on public.mcp_tokens;
create trigger mcp_tokens_notifications
after insert on public.mcp_tokens
for each row execute function public.notifications_integration_trigger();

drop trigger if exists ics_sources_notifications on public.ics_sources;
create trigger ics_sources_notifications
after insert on public.ics_sources
for each row execute function public.notifications_integration_trigger();

-- Lista uuid z tablicy JSON w metadanych audytu (JSON null / brak = pusta lista).
create or replace function public.notification_uuids(p_value jsonb)
returns setof uuid
language sql
immutable
set search_path = public
as $$
  select x::uuid
    from jsonb_array_elements_text(case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end) as t(x)
$$;

revoke all on function public.notification_uuids(jsonb) from public, anon, authenticated;

-- Zdarzenia z audit_log: bezpieczeństwo konta, obowiązki.
-- Wylogowanie ze wszystkich urządzeń i dezaktywacja odpinają też urządzenia push.
create or replace function public.notifications_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
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
        delete from public.push_subscriptions where user_id = new.entity_id;
      when 'user.access_revoked' then
        delete from public.push_subscriptions where user_id = new.entity_id;
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

revoke all on function public.notifications_audit_trigger() from public, anon, authenticated;

drop trigger if exists audit_log_notifications on public.audit_log;
create trigger audit_log_notifications
after insert on public.audit_log
for each row
when (new.action in (
  'user.sessions_revoked', 'user.access_revoked', 'mfa.admin_reset',
  'user.profile_update', 'module_owners.update'
))
execute function public.notifications_audit_trigger();

-- ============================================================================
-- 6. Podsumowania i zadania dzienne (cron, service_role)
-- ============================================================================

-- Treść podsumowania ('day' = dziś, 'week' = 7 dni od dziś). NULL = nic do pokazania.
-- Listy to rekordy osoby (przypisane albo utworzone i nieprzypisane); liczby biura tylko
-- dla Posła/administratora (jak w Pulsie: agregaty bez data_scope).
create or replace function public.notification_digest(p_user_id uuid, p_period text, p_today date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_role public.app_role;
  v_admin boolean;
  v_horizon date := case when p_period = 'week' then p_today + 6 else p_today end;
  v_from timestamptz := p_today::timestamp at time zone 'Europe/Warsaw';
  v_to timestamptz := (v_horizon + 1)::timestamp at time zone 'Europe/Warsaw';
  v_month_start date := date_trunc('month', p_today)::date;
  v_overdue jsonb;
  v_due jsonb;
  v_events jsonb;
  v_office jsonb;
  v_interp jsonb;
  v_budget jsonb;
  v_overdue_count integer;
  v_due_count integer;
  v_events_count integer;
begin
  if p_period not in ('day', 'week') then
    raise exception 'Okres podsumowania: day albo week' using errcode = '22023';
  end if;
  select role into v_role from public.profiles where id = p_user_id and is_active = true;
  if not found then
    return null;
  end if;
  v_admin := v_role in ('posel', 'administrator');

  with mine as (
    select c.id, c.title, c.due_date, c.priority
      from public.cases c
     where c.status not in ('załatwiona', 'odrzucona')
       and c.due_date is not null
       and (c.assigned_to = p_user_id or (c.assigned_to is null and c.created_by = p_user_id))
  )
  select
    (select count(*) from mine where due_date < p_today),
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'due_date', due_date,
       'days_overdue', p_today - due_date) order by due_date), '[]'::jsonb)
       from (select * from mine where due_date < p_today order by due_date limit 10) x),
    (select count(*) from mine where due_date between p_today and v_horizon),
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'due_date', due_date) order by due_date), '[]'::jsonb)
       from (select * from mine where due_date between p_today and v_horizon order by due_date limit 10) x)
  into v_overdue_count, v_overdue, v_due_count, v_due;

  select count(*), coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at,
           'all_day', e.all_day, 'location', e.location) order by e.starts_at) filter (where e.rn <= 15), '[]'::jsonb)
    into v_events_count, v_events
    from (
      select ev.*, row_number() over (order by ev.starts_at) as rn
        from public.events ev
       where (ev.assigned_to = p_user_id or (ev.assigned_to is null and ev.created_by = p_user_id))
         and ev.starts_at >= v_from and ev.starts_at < v_to
    ) e;

  if v_admin then
    select jsonb_build_object(
      'overdue_count', (select count(*) from public.cases
                         where status not in ('załatwiona', 'odrzucona') and due_date < p_today),
      'unassigned_count', (select count(*) from public.cases
                            where status not in ('załatwiona', 'odrzucona') and assigned_to is null),
      'public_new_count', (select count(*) from public.cases where source = 'public_form' and status = 'nowa'),
      'interpellations_pending', (select count(*) from public.interpellations
                                   where status in ('nowa', 'po_poprawkach') and archived_at is null)
    ) into v_office;
  end if;

  select jsonb_build_object(
    'remarks', (select count(*) from public.interpellations
                 where created_by = p_user_id and status = 'uwagi' and archived_at is null),
    'send_overdue', (select count(*) from public.interpellations
                      where status = 'zaakceptowana' and deadline_at < now() and archived_at is null
                        and (created_by = p_user_id or signatory_id = p_user_id))
  ) into v_interp;

  if p_period = 'week' and (v_admin or exists (
    select 1 from public.module_owners where module = 'budzet' and user_id = p_user_id
  )) then
    select jsonb_build_object(
      'month', to_char(v_month_start, 'YYYY-MM'),
      'spent', coalesce(sum(amount), 0),
      'limit', coalesce((select (value ->> 'monthly_limit_pln')::numeric from public.app_settings
                          where key = 'budget_settings'), 25000),
      'missing_invoices', count(*) filter (where receipt_path is null)
    ) into v_budget
    from public.office_expenses
    where expense_date >= v_month_start and expense_date < (v_month_start + interval '1 month')::date;
  end if;

  if v_overdue_count = 0 and v_due_count = 0 and v_events_count = 0
     and coalesce((v_interp ->> 'remarks')::int, 0) = 0
     and coalesce((v_interp ->> 'send_overdue')::int, 0) = 0
     and (v_office is null or (
       (v_office ->> 'overdue_count')::int = 0 and (v_office ->> 'public_new_count')::int = 0
       and (v_office ->> 'interpellations_pending')::int = 0)) then
    return null;
  end if;

  return jsonb_build_object(
    'period', p_period, 'today', p_today, 'horizon', v_horizon,
    'overdue_count', v_overdue_count, 'overdue_cases', v_overdue,
    'due_count', v_due_count, 'due_cases', v_due,
    'events_count', v_events_count, 'events', v_events,
    'office', v_office, 'interpellations', v_interp, 'budget', v_budget
  );
end;
$$;

revoke all on function public.notification_digest(uuid, text, date) from public, anon, authenticated;

-- Zadania dzienne: terminy spraw (jutro), plan dnia, podsumowanie tygodnia,
-- retencja kolejki (90 dni). Bez wywołań pg_net - cron po tym od razu sam wysyła.
create or replace function public.notifications_enqueue_daily(p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Europe/Warsaw')::date);
  v_week text := to_char(v_today, 'IYYY-IW');
  v_deadlines integer := 0;
  v_daily integer := 0;
  v_weekly integer := 0;
  v_purged integer;
  v_payload jsonb;
  r record;
begin
  perform set_config('notifications.no_kick', 'on', true);

  for r in
    select c.id, c.title, c.due_date, coalesce(c.assigned_to, c.created_by) as owner_id
      from public.cases c
     where c.due_date = v_today + 1
       and c.status not in ('załatwiona', 'odrzucona')
       and coalesce(c.assigned_to, c.created_by) is not null
  loop
    if public.notify(r.owner_id, 'case_deadline',
         jsonb_build_object('case_id', r.id, 'title', r.title, 'due_date', r.due_date),
         'due:' || r.id || ':' || r.due_date) then
      v_deadlines := v_deadlines + 1;
    end if;
  end loop;

  for r in
    select p.id, coalesce(np.weekly_digest_day, 1) as weekly_day
      from public.profiles p
      left join public.notification_preferences np on np.user_id = p.id
     where p.is_active = true
  loop
    if r.weekly_day = extract(isodow from v_today)
       and (coalesce(public.notification_wants(r.id, 'weekly_digest', 'email'), false)
            or coalesce(public.notification_wants(r.id, 'weekly_digest', 'push'), false)) then
      v_payload := public.notification_digest(r.id, 'week', v_today);
      if v_payload is not null and public.notify(r.id, 'weekly_digest', v_payload, 'week:' || v_week) then
        v_weekly := v_weekly + 1;
        continue; -- w dniu podsumowania tygodnia bez osobnego planu dnia
      end if;
    end if;
    if coalesce(public.notification_wants(r.id, 'daily_digest', 'email'), false)
       or coalesce(public.notification_wants(r.id, 'daily_digest', 'push'), false) then
      v_payload := public.notification_digest(r.id, 'day', v_today);
      if v_payload is not null and public.notify(r.id, 'daily_digest', v_payload, 'day:' || v_today) then
        v_daily := v_daily + 1;
      end if;
    end if;
  end loop;

  delete from public.notification_outbox where created_at < now() - interval '90 days';
  get diagnostics v_purged = row_count;
  delete from public.push_subscriptions where failure_count >= 10;

  return jsonb_build_object('deadlines', v_deadlines, 'daily', v_daily,
    'weekly', v_weekly, 'purged', v_purged);
end;
$$;

revoke all on function public.notifications_enqueue_daily(date) from public, anon, authenticated;
grant execute on function public.notifications_enqueue_daily(date) to service_role;

-- ============================================================================
-- 7. Sekret resend_api_key (jak klucze AI / GetResponse)
-- ============================================================================

drop policy if exists app_settings_no_secret_keys on public.app_settings;
create policy app_settings_no_secret_keys on public.app_settings
  as restrictive
  for all
  to authenticated
  using (key not in ('anthropic_api_key', 'getresponse_api_key', 'resend_api_key'))
  with check (key not in ('anthropic_api_key', 'getresponse_api_key', 'resend_api_key'));

create or replace function public.app_settings_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_keys constant text[] := array['anthropic_api_key', 'getresponse_api_key', 'resend_api_key'];
begin
  if tg_op = 'INSERT' then
    if new.key = any (v_secret_keys) then
      perform public.log_audit('setting.create', 'setting', null,
        jsonb_build_object('key', new.key, 'redacted', true,
          'configured', coalesce(btrim(new.value #>> '{}'), '') <> ''));
    else
      perform public.log_audit('setting.create', 'setting', null,
        jsonb_build_object('key', new.key, 'value', new.value));
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.key = any (v_secret_keys) or old.key = any (v_secret_keys) then
      perform public.log_audit('setting.update', 'setting', null,
        jsonb_build_object('key', new.key, 'redacted', true,
          'changed', old.value is distinct from new.value,
          'configured', coalesce(btrim(new.value #>> '{}'), '') <> ''));
    else
      perform public.log_audit('setting.update', 'setting', null,
        jsonb_build_object('key', new.key, 'old_value', old.value, 'new_value', new.value));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.key = any (v_secret_keys) then
      perform public.log_audit('setting.delete', 'setting', null,
        jsonb_build_object('key', old.key, 'redacted', true));
    else
      perform public.log_audit('setting.delete', 'setting', null,
        jsonb_build_object('key', old.key, 'value', old.value));
    end if;
    return old;
  end if;
  return null;
end;
$$;

revoke all on function public.app_settings_audit_trigger() from public, anon, authenticated;

create or replace function public.set_secret_setting(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_value text := btrim(p_value);
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_posel() then
    raise exception 'Brak uprawnien (wymagana rola: posel)' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  if p_key is null or p_key not in ('anthropic_api_key', 'getresponse_api_key', 'resend_api_key') then
    raise exception 'Niedozwolony klucz ustawienia' using errcode = '22023';
  end if;

  if v_value is null or v_value = '' then
    delete from public.app_settings where key = p_key;
    return;
  end if;

  if length(v_value) > 1000 then
    raise exception 'Wartosc klucza jest za dluga (max 1000 znakow)' using errcode = '22023';
  end if;

  insert into public.app_settings (key, value, updated_by, updated_at)
  values (p_key, to_jsonb(v_value), v_user_id, now())
  on conflict (key) do update
    set value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.set_secret_setting(text, text) from public, anon;
grant execute on function public.set_secret_setting(text, text) to authenticated;

create or replace function public.get_secret_settings_status()
returns table (key text, configured boolean, hint text)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_posel() then
    raise exception 'Brak uprawnien (wymagana rola: posel)' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  return query
  select
    k.setting_key,
    v.secret_value is not null,
    case when v.secret_value is not null then '••••' || right(v.secret_value, 4) end
  from unnest(array['anthropic_api_key', 'getresponse_api_key', 'resend_api_key']) as k(setting_key)
  left join lateral (
    select nullif(btrim(s.value #>> '{}'), '') as secret_value
      from public.app_settings s
     where s.key = k.setting_key
       and jsonb_typeof(s.value) = 'string'
  ) v on true
  order by k.setting_key;
end;
$$;

revoke all on function public.get_secret_settings_status() from public, anon;
grant execute on function public.get_secret_settings_status() to authenticated;

-- Powiadomienia - poprawki po przeglądzie kodu (20261109100000_notifications.sql już wdrożona).
--
--   1. Ponowienia: wiersz kolejki odłożony na później (błąd Resend, koniec czasu wywołania,
--      nieudane zgłoszenie pg_net) wysyłał się dopiero przy następnym nowym powiadomieniu albo
--      w porannym cronie. pg_cron co 2 minuty zgłasza wysyłkę, gdy coś czeka w kolejce.
--   2. Operacje przez MCP / PoliAI idą jako service_role (auth.uid() = NULL), więc osoba
--      dostawała powiadomienie o własnym działaniu, a w treści brakowało „kto”. Aktor z kolumn
--      rekordu: created_by (nowa sprawa / wydarzenie / interpelacja), decided_by (decyzja).
--   3. Drugie uruchomienie crona w dniu podsumowania tygodnia dosyłało jeszcze plan dnia.

create extension if not exists pg_cron with schema pg_catalog;

-- ============================================================================
-- 1. Zgłoszenie wysyłki + ponowienia
-- ============================================================================

-- POST na adres wysyłki zarejestrowany przez serwer. false = brak konfiguracji / pg_net / błąd.
create or replace function public.notifications_dispatch_request()
returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_url text;
  v_token text;
begin
  select dispatch_url, dispatch_token into v_url, v_token
    from public.notification_server_config where id;
  if v_url is null or v_token is null or not exists (select 1 from pg_extension where extname = 'pg_net') then
    return false;
  end if;
  -- Dynamiczny SQL: funkcja kompiluje się także bez pg_net.
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 30000)'
    using v_url, '{}'::jsonb,
      jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json');
  return true;
exception when others then
  raise warning 'notifications_dispatch_request: %', sqlerrm;
  return false;
end;
$$;

revoke all on function public.notifications_dispatch_request() from public, anon, authenticated;

create or replace function public.notifications_kick()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if coalesce(current_setting('notifications.no_kick', true), '') = 'on' then
    return null;
  end if;
  -- Tylko wiersze do zwykłej kolejki (test wysyła serwer od razu, ze statusem 'sending').
  if exists (select 1 from inserted where status = 'pending') then
    perform public.notifications_dispatch_request();
  end if;
  return null;
end;
$$;

revoke all on function public.notifications_kick() from public, anon, authenticated;

-- Wołane przez pg_cron: zgłasza wysyłkę, gdy w kolejce jest coś do wysłania teraz
-- (odłożone ponowienie, wiersz z wygasłą blokadą, powiadomienie bez udanego zgłoszenia).
create or replace function public.notifications_rekick()
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if exists (
    select 1 from public.notification_outbox
     where (status = 'pending' and next_attempt_at <= now())
        or (status = 'sending' and locked_until < now())
  ) then
    perform public.notifications_dispatch_request();
  end if;
end;
$$;

revoke all on function public.notifications_rekick() from public, anon, authenticated;

select cron.schedule('notifications-rekick', '*/2 * * * *', 'select public.notifications_rekick()');
-- Historia uruchomień pg_cron rośnie bez końca (720 wpisów dziennie z zadania wyżej).
select cron.schedule('cron-run-details-cleanup', '15 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);

-- ============================================================================
-- 2. Aktor operacji wykonanych przez MCP / PoliAI
-- ============================================================================

create or replace function public.notifications_cases_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := coalesce(auth.uid(), case when tg_op = 'INSERT' then new.created_by end);
begin
  begin
    if new.assigned_to is not null
       and new.assigned_to is distinct from v_actor
       and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
       and new.status not in ('załatwiona', 'odrzucona') then
      perform public.notify(new.assigned_to, 'case_assigned', jsonb_build_object(
        'case_id', new.id, 'title', new.title, 'due_date', new.due_date,
        'priority', new.priority, 'actor', public.notification_actor_name(v_actor)));
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

create or replace function public.notifications_events_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := coalesce(auth.uid(), case when tg_op = 'INSERT' then new.created_by end);
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

create or replace function public.notifications_interpellations_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  -- MCP: decyzję podejmuje decided_by, treść wgrywa autor.
  v_actor uuid := coalesce(
    auth.uid(),
    case when new.status in ('uwagi', 'zaakceptowana', 'odrzucona') then new.decided_by else new.created_by end
  );
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

-- ============================================================================
-- 3. Zadania dzienne: w dniu podsumowania tygodnia bez planu dnia także przy ponownym uruchomieniu
-- ============================================================================

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
      if v_payload is not null then
        if public.notify(r.id, 'weekly_digest', v_payload, 'week:' || v_week) then
          v_weekly := v_weekly + 1;
        end if;
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

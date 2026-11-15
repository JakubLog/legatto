-- Powiadomienia i ICS - poprawki bezpieczeństwa (przegląd SaaS: DBF-1/DBP-1/API-OTHER-1, DBF-4/EDGE-3, API-OTHER-5).
--
--   1. Adres wysyłki (cel net.http_post z tokenem w nagłówku) ustawia serwer wyłącznie z konfiguracji
--      operatora (NOTIFICATIONS_DISPATCH_URL / adres instancji), nie z app_settings. Baza dodatkowo
--      przyjmuje tylko https bez portu i stałą ścieżkę (http tylko host.docker.internal - lokalny test
--      z bazą w Dockerze). Zmiana adresu = nowy token (trigger), a obecne tokeny są rotowane, bo
--      mogły wyjść na adres wpisany przez administratora.
--   2. Formularz publiczny: powiadomienia `public_submission` grupowane w okna 15 minut na odbiorcę
--      (jedno od razu, kolejne zbiorczo w następnym oknie) - zalew zgłoszeń nie wysyła setek e-maili.
--   3. notify(): najwyżej 30 powiadomień na godzinę na odbiorcę dla rodzajów wyzwalanych działaniem
--      innych osób (bez alertów bezpieczeństwa i dziennych/tygodniowych z crona).
--   4. ics_sources: tylko https (webcal:// zamieniane na https://), port 443, najwyżej 20 źródeł.

-- ============================================================================
-- 1. Adres i token wysyłki
-- ============================================================================

-- Adresy spoza dozwolonego kształtu znikają (serwer zarejestruje adres z konfiguracji),
-- pozostałe dostają nowy token. Token sprawdza serwer z tej samej tabeli, więc rotacja
-- w bazie nie wymaga zmian po stronie Vercela.
update public.notification_server_config
   set dispatch_url = case
         when dispatch_url ~ '^(https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?|http://host\.docker\.internal:[0-9]{1,5})/api/notifications\?op=dispatch$'
         then dispatch_url
       end,
       dispatch_token = case
         when dispatch_url ~ '^(https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?|http://host\.docker\.internal:[0-9]{1,5})/api/notifications\?op=dispatch$'
         then replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
       end,
       updated_at = now()
 where dispatch_url is not null or dispatch_token is not null;

alter table public.notification_server_config
  drop constraint if exists notification_server_config_dispatch_url_check;
alter table public.notification_server_config
  drop constraint if exists notification_server_config_dispatch_url_safe;
alter table public.notification_server_config
  add constraint notification_server_config_dispatch_url_safe check (
    dispatch_url ~ '^(https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?|http://host\.docker\.internal:[0-9]{1,5})/api/notifications\?op=dispatch$'
  );

-- Nowy adres bez nowego tokenu = token losowany tutaj (stary przestaje działać);
-- brak adresu = brak tokenu.
create or replace function public.notification_server_config_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.dispatch_url is null then
    new.dispatch_token := null;
  elsif tg_op = 'UPDATE'
        and new.dispatch_url is distinct from old.dispatch_url
        and new.dispatch_token is not distinct from old.dispatch_token then
    new.dispatch_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  end if;
  return new;
end;
$$;

revoke all on function public.notification_server_config_guard() from public, anon, authenticated;

drop trigger if exists notification_server_config_guard on public.notification_server_config;
create trigger notification_server_config_guard
before insert or update on public.notification_server_config
for each row execute function public.notification_server_config_guard();

-- ============================================================================
-- 2-3. Limit na odbiorcę i grupowanie zgłoszeń z formularza
-- ============================================================================

create index if not exists notification_outbox_user_created_idx
  on public.notification_outbox (user_id, created_at desc);

-- Wstawia powiadomienie do kolejki, jeśli odbiorca chce choć jeden kanał. true = wstawiono.
-- Push liczy się tylko przy zarejestrowanym urządzeniu. Ten sam dedupe_key = bez duplikatu.
-- Rodzaje wyzwalane działaniem innych osób: najwyżej 30 na godzinę na odbiorcę (alerty
-- bezpieczeństwa i powiadomienia z crona bez limitu).
create or replace function public.notify(p_user_id uuid, p_kind text, p_payload jsonb, p_dedupe_key text default null)
returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_unlimited constant text[] := array[
    'security_account', 'security_integration', 'case_deadline', 'weekly_digest', 'daily_digest', 'test'];
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

  if not (p_kind = any (v_unlimited)) and (
    select count(*) from public.notification_outbox o
     where o.user_id = p_user_id
       and o.created_at > now() - interval '1 hour'
       and not (o.kind = any (v_unlimited))
  ) >= 30 then
    raise log 'notify: limit godzinowy odbiorcy % (%)', p_user_id, p_kind;
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

-- Zgłoszenie z formularza dla jednego odbiorcy, w oknach 15 minut (klucz public:<nr okna>):
--   - czekające powiadomienie bieżącego albo następnego okna = licznik +1 (treść zbiorcza);
--   - inaczej pierwsze w oknie wychodzi od razu;
--   - gdy w tym oknie już wyszło - zbiorcze w następnym oknie (next_attempt_at = jego początek,
--     wysyła je rekick z pg_cron). Ciągły zalew = jedno powiadomienie na 15 minut.
create or replace function public.notify_public_submission(p_user_id uuid, p_case_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_window bigint := floor(extract(epoch from now()) / 900)::bigint;
  v_current text := 'public:' || v_window;
  v_next text := 'public:' || (v_window + 1);
  v_payload jsonb := jsonb_build_object('case_id', p_case_id, 'title', p_title);
begin
  update public.notification_outbox o
     set payload = jsonb_build_object('count', coalesce((o.payload ->> 'count')::integer, 1) + 1)
   where o.id = (
     select q.id from public.notification_outbox q
      where q.user_id = p_user_id
        and q.kind = 'public_submission'
        and q.status = 'pending'
        and q.dedupe_key in (v_current, v_next)
      order by q.dedupe_key desc
      limit 1
      for update
   );
  if found then
    return;
  end if;

  if public.notify(p_user_id, 'public_submission', v_payload, v_current) then
    return;
  end if;

  if public.notify(p_user_id, 'public_submission', v_payload, v_next) then
    update public.notification_outbox
       set next_attempt_at = to_timestamp((v_window + 1) * 900)
     where user_id = p_user_id and kind = 'public_submission' and dedupe_key = v_next;
  end if;
end;
$$;

revoke all on function public.notify_public_submission(uuid, uuid, text) from public, anon, authenticated;

-- Jak w 20261109200000_notifications_fixes.sql; zmiana: zgłoszenia z formularza przez
-- notify_public_submission (grupowanie) zamiast osobnego powiadomienia na każde zgłoszenie.
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
      perform public.notify_public_submission(p.id, new.id, new.title)
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

-- ============================================================================
-- 4. Źródła ICS
-- ============================================================================

-- Pobiera je serwer (api/_lib/safe-fetch.ts: tylko https:443, adresy publiczne). Limit liczby
-- źródeł ogranicza codzienny transfer crona; istniejące wiersze sprawdzane dopiero przy zmianie url.
create or replace function public.ics_sources_guard()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if tg_op = 'INSERT' or new.url is distinct from old.url then
    new.url := btrim(new.url);
    if new.url ~* '^webcal://' then
      new.url := 'https://' || substr(new.url, 10);
    end if;
    if new.url !~* '^https://[^/:@?#\s]+(:443)?([/?#]|$)' or char_length(new.url) > 2000 then
      raise exception 'Adres kalendarza musi zaczynać się od https:// (bez innego portu niż 443).'
        using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('public.ics_sources_guard'));
    if (select count(*) from public.ics_sources) >= 20 then
      raise exception 'Biuro może mieć najwyżej 20 źródeł ICS. Usuń nieużywane źródło.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.ics_sources_guard() from public, anon, authenticated;

drop trigger if exists ics_sources_guard on public.ics_sources;
create trigger ics_sources_guard
before insert or update of url on public.ics_sources
for each row execute function public.ics_sources_guard();

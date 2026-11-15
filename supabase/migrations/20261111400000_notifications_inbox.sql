-- Powiadomienia w aplikacji (dzwonek w TopBarze) + rodzaje case_mention / case_comment.
--
-- Model:
--   - `notify()` = `notify_in_app()` (skrzynka) + `notify_outbox()` (kolejka e-mail/push, treść
--     dawnego `notify()` z 20261110100000 bez zmian). Skrzynka jest w osobnym bloku
--     `exception`: jej błąd nigdy nie zabiera e-maila ani push tego zdarzenia.
--   - Skrzynka `notification_inbox`: wiersz, gdy odbiorca chce kanał `in_app` dla rodzaju
--     (preferencje `notification_preferences.kinds -> kind -> in_app`, domyślnie włączone poza
--     `admin_default_only` dla ról spoza Posła/administratora; podsumowania i test nigdy).
--     Duplikaty blokuje UNIQUE (user_id, kind, dedupe_key). Własny limit 100/h na odbiorcę
--     (poza security_account, security_integration, case_deadline), niezależny od limitu 30/h
--     kolejki.
--   - Zgłoszenia z formularza (`notify_public_submission`): jeden wiersz na okno 15 min
--     (`public:<nr okna>`), kolejne zgłoszenia w oknie zwiększają licznik `count` i przenoszą
--     wiersz na górę jako nieprzeczytany. Kolejka woła `notify_outbox` (okna jak dotąd).
--   - Klient czyta tylko własne wiersze (RLS + aal2), zapis wyłącznie RPC `mark_my_inbox_read`
--     (p_ids albo p_until). Tabela w publikacji `supabase_realtime` (dzwonek na żywo).
--   - Zmiana roli, scope_* albo dezaktywacja czyści skrzynkę użytkownika poza security_*
--     (trigger `profiles_purge_inbox_on_access_change`; payload to migawka treści).
--   - Retencja 90 dni (pg_cron `notification-inbox-retention`).
--   - Katalog: `case_mention` (wzmianka @ w komentarzu sprawy; e-mail i push domyślnie włączone)
--     i `case_comment` (nowy komentarz w mojej sprawie; domyślnie tylko w aplikacji).
--     Redefinicja w bloku DO z asercją: migracja zatrzymuje się, gdy nowa lista gubi albo
--     zmienia rodzaj z poprzedniej definicji (np. dopisany przez inną migrację). Nowe rodzaje
--     dopisywać wyłącznie w migracji o wersji wyższej niż ta, z pełną listą.

-- ============================================================================
-- 1. Katalog rodzajów (jak w 20261111100000_signing_documents.sql + case_mention, case_comment)
-- ============================================================================

do $$
declare
  v_before jsonb;
  v_lost text;
begin
  if to_regprocedure('public.notification_catalog()') is not null then
    execute 'select jsonb_agg(to_jsonb(c)) from public.notification_catalog() c' into v_before;
  end if;

  execute $fn$
    create or replace function public.notification_catalog()
    returns table (kind text, admin_only boolean, email_default boolean, push_default boolean, admin_default_only boolean)
    language sql
    immutable
    set search_path = public
    as $cat$
      values
        ('security_integration',    false, true,  true,  false),
        ('security_account',        false, true,  true,  false),
        ('case_assigned',           false, true,  true,  false),
        ('case_deadline',           false, true,  false, false),
        ('case_mention',            false, true,  true,  false),
        ('case_comment',            false, false, false, false),
        ('public_submission',       false, true,  true,  true),
        ('event_assigned',          false, true,  true,  false),
        ('interpellation_review',   true,  true,  true,  false),
        ('interpellation_decision', false, true,  true,  false),
        ('signing_request',         true,  true,  true,  false),
        ('signing_decision',        false, true,  true,  false),
        ('responsibility',          false, true,  true,  false),
        ('weekly_digest',           false, true,  false, false),
        ('daily_digest',            false, false, false, false)
    $cat$
  $fn$;

  select string_agg(b ->> 'kind', ', ') into v_lost
    from jsonb_array_elements(coalesce(v_before, '[]'::jsonb)) b
   where not exists (select 1 from public.notification_catalog() c where to_jsonb(c) = b);
  if v_lost is not null then
    raise exception 'notification_catalog: migracja 20261111400000 gubi albo zmienia rodzaje: %', v_lost;
  end if;
end $$;

revoke all on function public.notification_catalog() from public, anon, authenticated;

-- Czy rodzaj ma kanał „w aplikacji” (podsumowania i test - tylko e-mail/push).
create or replace function public.notification_in_app_kind(p_kind text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_kind is not null and p_kind not in ('weekly_digest', 'daily_digest', 'test')
$$;

revoke all on function public.notification_in_app_kind(text) from public, anon, authenticated;

-- ============================================================================
-- 2. Skrzynka powiadomień
-- ============================================================================

create table if not exists public.notification_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notification_inbox_user_kind_dedupe_key unique (user_id, kind, dedupe_key)
);

create index if not exists notification_inbox_user_created_idx
  on public.notification_inbox (user_id, created_at desc, id desc);
create index if not exists notification_inbox_unread_idx
  on public.notification_inbox (user_id)
  where read_at is null;
drop index if exists public.notification_inbox_created_idx;

alter table public.notification_inbox enable row level security;
revoke all on public.notification_inbox from public, anon, authenticated;
-- SELECT potrzebny dla Realtime (postgres_changes sprawdza RLS subskrybenta); zapis tylko RPC.
grant select on public.notification_inbox to authenticated;
grant all on public.notification_inbox to service_role;

drop policy if exists notification_inbox_select_own on public.notification_inbox;
create policy notification_inbox_select_own
on public.notification_inbox for select
to authenticated
using (user_id = auth.uid() and public.is_authenticated_active() and public.is_aal2());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
         from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'notification_inbox'
     ) then
    alter publication supabase_realtime add table public.notification_inbox;
  end if;
end $$;

-- ============================================================================
-- 3. Preferencje: kanał in_app
-- ============================================================================

-- Jak w 20261109100000_notifications.sql + kanał 'in_app' (bez przełącznika globalnego;
-- domyślnie włączony, poza rodzajami admin_default_only dla ról spoza Posła/administratora).
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
    when p_channel = 'in_app' then
      public.notification_in_app_kind(p_kind)
      and coalesce(
        (np.kinds -> p_kind ->> 'in_app')::boolean,
        not (c.admin_default_only and p.role not in ('posel', 'administrator'))
      )
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
    and p_channel in ('email', 'push', 'in_app')
$$;

revoke all on function public.notification_wants(uuid, text, text) from public, anon, authenticated;

-- Jak w 20261109100000_notifications.sql + klucz 'in_app' dla rodzajów z kanałem w aplikacji
-- (podsumowania bez klucza - klient nie pokazuje przełącznika).
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
      ) || case when public.notification_in_app_kind(c.kind) then jsonb_build_object(
        'in_app', coalesce((np.kinds -> c.kind ->> 'in_app')::boolean,
          not (c.admin_default_only and p.role not in ('posel', 'administrator')))
      ) else '{}'::jsonb end), '{}'::jsonb)
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

-- Jak w 20261109100000_notifications.sql + kanał 'in_app' (tylko rodzaje z kanałem w aplikacji).
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
      raise exception 'Ustawienie % musi być obiektem { email, push, in_app }', v_kind using errcode = '22023';
    end if;
    for v_channel in select jsonb_object_keys(v_value) loop
      if v_channel not in ('email', 'push', 'in_app')
         or jsonb_typeof(v_value -> v_channel) <> 'boolean'
         or (v_channel = 'in_app' and not public.notification_in_app_kind(v_kind)) then
        raise exception 'Ustawienie %.%: dozwolone email/push/in_app typu boolean', v_kind, v_channel using errcode = '22023';
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

-- ============================================================================
-- 4. notify(): kolejka e-mail/push + skrzynka
-- ============================================================================

-- Kolejka e-mail/push - treść notify() z 20261110100000_notifications_hardening.sql bez zmian.
create or replace function public.notify_outbox(p_user_id uuid, p_kind text, p_payload jsonb, p_dedupe_key text default null)
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

revoke all on function public.notify_outbox(uuid, text, jsonb, text) from public, anon, authenticated;

-- Skrzynka w aplikacji: ten sam dedupe_key = bez duplikatu; limit 100/h na odbiorcę (rodzaje
-- wyzwalane przez inne osoby lub automaty MCP/PoliAI), poza alertami bezpieczeństwa i terminami.
create or replace function public.notify_in_app(p_user_id uuid, p_kind text, p_payload jsonb, p_dedupe_key text default null)
returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_unlimited constant text[] := array['security_account', 'security_integration', 'case_deadline'];
  v_rows integer;
begin
  if p_user_id is null or not coalesce(public.notification_wants(p_user_id, p_kind, 'in_app'), false) then
    return false;
  end if;

  if not (p_kind = any (v_unlimited)) and (
    select count(*) from public.notification_inbox i
     where i.user_id = p_user_id
       and i.created_at > now() - interval '1 hour'
       and not (i.kind = any (v_unlimited))
  ) >= 100 then
    raise log 'notify_in_app: limit godzinowy odbiorcy % (%)', p_user_id, p_kind;
    return false;
  end if;

  insert into public.notification_inbox (user_id, kind, payload, dedupe_key)
  values (p_user_id, p_kind, coalesce(p_payload, '{}'::jsonb), p_dedupe_key)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.notify_in_app(uuid, text, jsonb, text) from public, anon, authenticated;

-- Powiadomienie: skrzynka w aplikacji + kolejka e-mail/push (niezależnie). true = coś wstawiono.
create or replace function public.notify(p_user_id uuid, p_kind text, p_payload jsonb, p_dedupe_key text default null)
returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_in_app boolean := false;
  v_outbox boolean;
begin
  if p_user_id is null then
    return false;
  end if;
  begin
    v_in_app := coalesce(public.notify_in_app(p_user_id, p_kind, p_payload, p_dedupe_key), false);
  exception when others then
    -- Skrzynka nigdy nie blokuje e-maila/push tego zdarzenia.
    raise warning 'notify (in_app): %', sqlerrm;
  end;
  v_outbox := coalesce(public.notify_outbox(p_user_id, p_kind, p_payload, p_dedupe_key), false);
  return v_in_app or v_outbox;
end;
$$;

revoke all on function public.notify(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.notify(uuid, text, jsonb, text) to service_role;

-- Jak w 20261110100000_notifications_hardening.sql (kolejka: okna 15 min, licznik, zbiorcze w
-- następnym oknie) + skrzynka: jeden wiersz na bieżące okno, kolejne zgłoszenia = count +1,
-- wiersz wraca na górę jako nieprzeczytany.
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
  if p_user_id is null then
    return;
  end if;

  begin
    if coalesce(public.notification_wants(p_user_id, 'public_submission', 'in_app'), false) then
      insert into public.notification_inbox as i (user_id, kind, payload, dedupe_key)
      values (p_user_id, 'public_submission', v_payload, v_current)
      on conflict (user_id, kind, dedupe_key) do update
        set payload = jsonb_build_object('count', coalesce((i.payload ->> 'count')::integer, 1) + 1),
            created_at = now(),
            read_at = null;
    end if;
  exception when others then
    -- Skrzynka nigdy nie blokuje e-maila/push zgłoszenia (jak w notify()).
    raise warning 'notify_public_submission (in_app): %', sqlerrm;
  end;

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

  if public.notify_outbox(p_user_id, 'public_submission', v_payload, v_current) then
    return;
  end if;

  if public.notify_outbox(p_user_id, 'public_submission', v_payload, v_next) then
    update public.notification_outbox
       set next_attempt_at = to_timestamp((v_window + 1) * 900)
     where user_id = p_user_id and kind = 'public_submission' and dedupe_key = v_next;
  end if;
end;
$$;

revoke all on function public.notify_public_submission(uuid, uuid, text) from public, anon, authenticated;

-- ============================================================================
-- 5. RPC skrzynki (każda rola, własne wiersze, aal2)
-- ============================================================================

-- Najnowsze najpierw. Strona starsza: p_before (+ p_before_id przy równych czasach) z ostatniego
-- wiersza poprzedniej strony.
create or replace function public.get_my_inbox(
  p_limit integer default 30,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  kind text,
  payload jsonb,
  created_at timestamptz,
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.is_authenticated_active() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  return query
  select i.id, i.kind, i.payload, i.created_at, i.read_at
    from public.notification_inbox i
   where i.user_id = v_user_id
     and (
       p_before is null
       or i.created_at < p_before
       or (p_before_id is not null and i.created_at = p_before and i.id < p_before_id)
     )
   order by i.created_at desc, i.id desc
   limit greatest(1, least(coalesce(p_limit, 30), 100));
end;
$$;

revoke all on function public.get_my_inbox(integer, timestamptz, uuid) from public, anon;
grant execute on function public.get_my_inbox(integer, timestamptz, uuid) to authenticated;

create or replace function public.get_my_inbox_unread_count()
returns integer
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.is_authenticated_active() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  return (
    select count(*)::integer
      from public.notification_inbox i
     where i.user_id = v_user_id
       and i.read_at is null
  );
end;
$$;

revoke all on function public.get_my_inbox_unread_count() from public, anon;
grant execute on function public.get_my_inbox_unread_count() to authenticated;

-- Oznacza moje powiadomienia jako przeczytane. p_ids = wskazane pozycje; p_ids NULL = wszystkie
-- nieprzeczytane, a z p_until tylko utworzone do tej chwili włącznie (pozycje, które przyszły po
-- wczytaniu listy, zostają nieprzeczytane). Zwraca liczbę zmienionych.
drop function if exists public.mark_my_inbox_read(uuid[]);
create or replace function public.mark_my_inbox_read(p_ids uuid[] default null, p_until timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_rows integer;
begin
  if v_user_id is null or not public.is_authenticated_active() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;
  if p_ids is not null and cardinality(p_ids) > 500 then
    raise exception 'Za dużo powiadomień naraz (maks. 500)' using errcode = '22023';
  end if;

  update public.notification_inbox i
     set read_at = now()
   where i.user_id = v_user_id
     and i.read_at is null
     and (p_ids is null or i.id = any (p_ids))
     and (p_until is null or i.created_at <= p_until);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.mark_my_inbox_read(uuid[], timestamptz) from public, anon;
grant execute on function public.mark_my_inbox_read(uuid[], timestamptz) to authenticated;

-- ============================================================================
-- 6. Czyszczenie skrzynki po zmianie uprawnień
-- ============================================================================

-- Payload to migawka treści (tytuły spraw, fragmenty komentarzy) z chwili zdarzenia. Po zmianie
-- roli, scope_* albo dezaktywacji usuwamy skrzynkę użytkownika poza security_* (ta sama zmiana
-- emituje „Zmieniono Twoje uprawnienia”; te rodzaje nie niosą treści rekordów). Warunek jak w
-- 20261110130000_poliai_scope_change_purge.sql.
create or replace function public.profiles_purge_inbox_on_access_change()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  delete from public.notification_inbox
   where user_id = new.id
     and kind not like 'security\_%';
  return null;
end;
$$;

revoke all on function public.profiles_purge_inbox_on_access_change() from public, anon, authenticated;

drop trigger if exists profiles_purge_inbox_on_access_change on public.profiles;
create trigger profiles_purge_inbox_on_access_change
  after update of role, is_active, scope_contacts, scope_cases, scope_events, scope_interpellations
  on public.profiles
  for each row
  when (
    old.role is distinct from new.role
    or old.scope_contacts is distinct from new.scope_contacts
    or old.scope_cases is distinct from new.scope_cases
    or old.scope_events is distinct from new.scope_events
    or old.scope_interpellations is distinct from new.scope_interpellations
    or (old.is_active and not new.is_active)
  )
  execute function public.profiles_purge_inbox_on_access_change();

-- ============================================================================
-- 7. Retencja 90 dni
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('notification-inbox-retention', '45 3 * * *',
      $job$delete from public.notification_inbox where created_at < now() - interval '90 days'$job$);
  end if;
end $$;

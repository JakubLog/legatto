-- Historia sprawy: dziennik zdarzeń (case_activity) + komentarze z @wzmiankami (case_comments).
--
-- case_activity zapisują tylko triggery (cases, case_attachments); klient ma wyłącznie SELECT.
-- case_comments: INSERT przez RLS (writer + widoczna sprawa), DELETE własnych (Poseł/administrator: wszystkich),
-- bez UPDATE. Wzmianki czyszczone w BEFORE INSERT (bez duplikatów, bez siebie, tylko aktywne osoby,
-- które widzą sprawę - ten sam predykat co RLS `cases_select_authenticated`).
-- Powiadomienia: case_mention (wzmiankowani) i case_comment (przypisana osoba + autor sprawy),
-- payload i dedupe_key wg kontraktu z 20261111400000_notifications_inbox.sql. Błąd powiadomienia
-- nigdy nie blokuje komentarza.
--
-- Migracja idempotentna (create or replace / if not exists / drop ... if exists).

-- ============================================================================
-- 1. Widoczność sprawy dla wskazanej osoby (ten sam predykat co RLS cases)
-- ============================================================================

create or replace function public.case_visible_to(p_case_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
      from public.cases c
      join public.profiles p on p.id = p_user_id
     where c.id = p_case_id
       and p.is_active = true
       and (
         p.role in ('posel', 'administrator')
         or p.scope_cases = 'all'
         or c.created_by = p_user_id
         or c.assigned_to = p_user_id
       )
  )
$$;

revoke all on function public.case_visible_to(uuid, uuid) from public, anon, authenticated;

-- ============================================================================
-- 2. case_activity
-- ============================================================================

create table if not exists public.case_activity (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  kind text not null,
  data jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.case_activity drop constraint if exists case_activity_kind_check;
alter table public.case_activity add constraint case_activity_kind_check check (kind in (
  'created', 'status', 'assigned', 'priority', 'due_date', 'category', 'title', 'description',
  'attachment_added', 'attachment_removed'
));

create index if not exists case_activity_case_created_idx on public.case_activity (case_id, created_at);

alter table public.case_activity enable row level security;

revoke all on table public.case_activity from public, anon, authenticated;
grant select on table public.case_activity to authenticated;
grant all on table public.case_activity to service_role;

drop policy if exists case_activity_select on public.case_activity;
create policy case_activity_select on public.case_activity
  for select to authenticated
  using (
    public.is_authenticated_active()
    and public.is_aal2()
    and exists (select 1 from public.cases c where c.id = case_activity.case_id)
  );

-- Backfill (tylko sprawy bez żadnego wpisu): utworzenie + zmiany statusu i przypisania z audit_log.
with targets as (
  select c.id, c.created_by, c.created_at, c.source
    from public.cases c
   where not exists (select 1 from public.case_activity a where a.case_id = c.id)
)
insert into public.case_activity (case_id, kind, data, actor_id, created_at)
select t.id, 'created', jsonb_build_object('source', t.source), t.created_by, t.created_at
  from targets t
union all
select t.id, 'status',
       jsonb_build_object('from', l.metadata ->> 'from', 'to', l.metadata ->> 'to'),
       p.id, l.created_at
  from targets t
  join public.audit_log l on l.entity_type = 'case' and l.entity_id = t.id and l.action = 'case.status_change'
  left join public.profiles p on p.id = l.user_id
union all
select t.id, 'assigned',
       jsonb_build_object(
         'from', l.metadata ->> 'from', 'from_name', pf.full_name,
         'to', l.metadata ->> 'to', 'to_name', pt.full_name),
       p.id, l.created_at
  from targets t
  join public.audit_log l on l.entity_type = 'case' and l.entity_id = t.id and l.action = 'case.reassign'
  left join public.profiles p on p.id = l.user_id
  left join public.profiles pf on pf.id::text = l.metadata ->> 'from'
  left join public.profiles pt on pt.id::text = l.metadata ->> 'to';

-- Aktor: zalogowany użytkownik; zapis serwisowy (service_role/MCP bez sesji) przy INSERT = created_by,
-- przy UPDATE = NULL ("System") - jak notifications_cases_trigger.
create or replace function public.case_activity_cases_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := coalesce(auth.uid(), case when tg_op = 'INSERT' then new.created_by end);
begin
  if v_actor is not null and not exists (select 1 from public.profiles where id = v_actor) then
    v_actor := null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.case_activity (case_id, kind, data, actor_id)
    values (new.id, 'created', jsonb_build_object('source', new.source), v_actor);
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.case_activity (case_id, kind, data, actor_id)
    values (new.id, 'status', jsonb_build_object('from', old.status, 'to', new.status), v_actor);
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.case_activity (case_id, kind, data, actor_id)
    values (new.id, 'assigned', jsonb_build_object(
      'from', old.assigned_to,
      'from_name', (select full_name from public.profiles where id = old.assigned_to),
      'to', new.assigned_to,
      'to_name', (select full_name from public.profiles where id = new.assigned_to)
    ), v_actor);
  end if;

  if new.priority is distinct from old.priority then
    insert into public.case_activity (case_id, kind, data, actor_id)
    values (new.id, 'priority', jsonb_build_object('from', old.priority, 'to', new.priority), v_actor);
  end if;

  if new.due_date is distinct from old.due_date then
    insert into public.case_activity (case_id, kind, data, actor_id)
    values (new.id, 'due_date', jsonb_build_object('from', old.due_date, 'to', new.due_date), v_actor);
  end if;

  if new.category_id is distinct from old.category_id then
    insert into public.case_activity (case_id, kind, data, actor_id)
    values (new.id, 'category', jsonb_build_object(
      'from', old.category_id,
      'from_name', (select name from public.case_categories where id = old.category_id),
      'to', new.category_id,
      'to_name', (select name from public.case_categories where id = new.category_id)
    ), v_actor);
  end if;

  if new.title is distinct from old.title then
    insert into public.case_activity (case_id, kind, data, actor_id)
    values (new.id, 'title', jsonb_build_object('from', old.title, 'to', new.title), v_actor);
  end if;

  if new.description is distinct from old.description then
    insert into public.case_activity (case_id, kind, data, actor_id)
    values (new.id, 'description', '{}'::jsonb, v_actor);
  end if;

  return null;
end;
$$;

revoke all on function public.case_activity_cases_trigger() from public, anon, authenticated;

drop trigger if exists cases_activity on public.cases;
create trigger cases_activity
  after insert or update on public.cases
  for each row execute function public.case_activity_cases_trigger();

create or replace function public.case_activity_attachments_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    v_actor := coalesce(v_actor, new.created_by);
    if v_actor is not null and not exists (select 1 from public.profiles where id = v_actor) then
      v_actor := null;
    end if;
    insert into public.case_activity (case_id, kind, data, actor_id)
    values (new.case_id, 'attachment_added',
            jsonb_build_object('attachment_id', new.id, 'filename', new.filename), v_actor);
  -- Kaskadowe usunięcie całej sprawy: sprawy już nie ma, wpis nie ma sensu (i złamałby FK).
  elsif exists (select 1 from public.cases where id = old.case_id) then
    if v_actor is not null and not exists (select 1 from public.profiles where id = v_actor) then
      v_actor := null;
    end if;
    insert into public.case_activity (case_id, kind, data, actor_id)
    values (old.case_id, 'attachment_removed',
            jsonb_build_object('attachment_id', old.id, 'filename', old.filename), v_actor);
  end if;
  return null;
end;
$$;

revoke all on function public.case_activity_attachments_trigger() from public, anon, authenticated;

drop trigger if exists case_attachments_activity on public.case_attachments;
create trigger case_attachments_activity
  after insert or delete on public.case_attachments
  for each row execute function public.case_activity_attachments_trigger();

-- ============================================================================
-- 3. case_comments
-- ============================================================================

create table if not exists public.case_comments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.case_comments drop constraint if exists case_comments_body_check;
alter table public.case_comments add constraint case_comments_body_check
  check (char_length(body) between 1 and 4000);
alter table public.case_comments drop constraint if exists case_comments_mentions_check;
alter table public.case_comments add constraint case_comments_mentions_check
  check (cardinality(mentions) <= 50);

create index if not exists case_comments_case_created_idx on public.case_comments (case_id, created_at);

alter table public.case_comments enable row level security;

revoke all on table public.case_comments from public, anon, authenticated;
grant select, delete on table public.case_comments to authenticated;
grant insert (case_id, body, mentions) on table public.case_comments to authenticated;
grant all on table public.case_comments to service_role;

drop policy if exists case_comments_select on public.case_comments;
create policy case_comments_select on public.case_comments
  for select to authenticated
  using (
    public.is_authenticated_active()
    and public.is_aal2()
    and exists (select 1 from public.cases c where c.id = case_comments.case_id)
  );

drop policy if exists case_comments_insert on public.case_comments;
create policy case_comments_insert on public.case_comments
  for insert to authenticated
  with check (
    public.is_writer()
    and public.is_aal2()
    and author_id = auth.uid()
    and exists (select 1 from public.cases c where c.id = case_comments.case_id)
  );

drop policy if exists case_comments_delete on public.case_comments;
create policy case_comments_delete on public.case_comments
  for delete to authenticated
  using (
    public.is_authenticated_active()
    and public.is_aal2()
    and (author_id = auth.uid() or public.is_posel())
    and exists (select 1 from public.cases c where c.id = case_comments.case_id)
  );

-- Normalizacja: treść bez białych znaków na brzegach, autor = sesja, czas serwera, czyste wzmianki.
create or replace function public.case_comments_prepare()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  new.body := regexp_replace(coalesce(new.body, ''), '^\s+|\s+$', '', 'g');
  if auth.uid() is not null or current_user in ('authenticated', 'anon') then
    new.author_id := auth.uid();
  end if;
  new.created_at := now();
  new.mentions := coalesce((
    select array_agg(m.id order by m.id)
      from (select distinct u as id from unnest(coalesce(new.mentions, '{}'::uuid[])) u) m
     where m.id is distinct from new.author_id
       and public.case_visible_to(new.case_id, m.id)
  ), '{}'::uuid[]);
  return new;
end;
$$;

revoke all on function public.case_comments_prepare() from public, anon, authenticated;

drop trigger if exists case_comments_prepare on public.case_comments;
create trigger case_comments_prepare
  before insert on public.case_comments
  for each row execute function public.case_comments_prepare();

create or replace function public.case_comments_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_case record;
  v_text text;
  v_payload jsonb;
  v_uid uuid;
begin
  perform public.log_audit('case.comment', 'case', new.case_id, jsonb_build_object('comment_id', new.id));

  begin
    select id, title, assigned_to, created_by into v_case from public.cases where id = new.case_id;
    v_text := btrim(regexp_replace(new.body, '\s+', ' ', 'g'));
    v_payload := jsonb_build_object(
      'case_id', new.case_id,
      'case_title', v_case.title,
      'actor_name', coalesce(public.notification_actor_name(new.author_id), 'System'),
      'excerpt', case when char_length(v_text) > 160 then left(v_text, 159) || '…' else v_text end,
      'comment_id', new.id
    );

    foreach v_uid in array new.mentions loop
      begin
        perform public.notify(v_uid, 'case_mention', v_payload, 'comment:' || new.id);
      exception when others then
        raise warning 'case_comments_after_insert (case_mention): %', sqlerrm;
      end;
    end loop;

    for v_uid in
      select distinct u
        from unnest(array[v_case.assigned_to, v_case.created_by]) u
       where u is not null
         and u is distinct from new.author_id
         and not (u = any (new.mentions))
         and public.case_visible_to(new.case_id, u)
    loop
      begin
        perform public.notify(v_uid, 'case_comment', v_payload, 'comment:' || new.id);
      exception when others then
        raise warning 'case_comments_after_insert (case_comment): %', sqlerrm;
      end;
    end loop;
  exception when others then
    raise warning 'case_comments_after_insert: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.case_comments_after_insert() from public, anon, authenticated;

drop trigger if exists case_comments_after_insert on public.case_comments;
create trigger case_comments_after_insert
  after insert on public.case_comments
  for each row execute function public.case_comments_after_insert();

create or replace function public.case_comments_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  -- Kaskadowe usunięcie sprawy loguje case.delete; pojedynczych komentarzy nie powielamy.
  if exists (select 1 from public.cases where id = old.case_id) then
    perform public.log_audit('case.comment_delete', 'case', old.case_id,
      jsonb_build_object('comment_id', old.id, 'author_id', old.author_id));
  end if;
  return null;
end;
$$;

revoke all on function public.case_comments_after_delete() from public, anon, authenticated;

drop trigger if exists case_comments_after_delete on public.case_comments;
create trigger case_comments_after_delete
  after delete on public.case_comments
  for each row execute function public.case_comments_after_delete();

-- ============================================================================
-- 4. Kogo można wzmiankować w sprawie (osoby, które ją widzą; bez wywołującego)
-- ============================================================================

create or replace function public.get_case_mentionable_users(p_case_id uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  if not (public.is_authenticated_active() and public.is_aal2()
          and public.case_visible_to(p_case_id, auth.uid())) then
    raise exception 'Brak dostępu' using errcode = '42501';
  end if;

  return query
    select p.id
      from public.profiles p
     where p.is_active = true
       and p.id <> auth.uid()
       and public.case_visible_to(p_case_id, p.id);
end;
$$;

revoke all on function public.get_case_mentionable_users(uuid) from public, anon;
grant execute on function public.get_case_mentionable_users(uuid) to authenticated, service_role;

-- ============================================================================
-- 5. Realtime (RLS SELECT obowiązuje także subskrybentów)
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'case_activity') then
      alter publication supabase_realtime add table public.case_activity;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'case_comments') then
      alter publication supabase_realtime add table public.case_comments;
    end if;
  end if;
end $$;

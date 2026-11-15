-- ePosel — Faza: Integracja kalendarza ICS
-- Idempotentna (IF NOT EXISTS) — bezpieczna przy ponownym push po częściowym błędzie

-- ===== ICS SOURCES =====
create table if not exists public.ics_sources (
  id                  uuid        primary key default gen_random_uuid(),
  name                text        not null,
  url                 text        not null,
  is_active           boolean     not null default true,
  last_synced_at      timestamptz,
  synced_event_count  integer     not null default 0,
  created_by          uuid        references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'ics_sources_set_updated_at'
  ) then
    create trigger ics_sources_set_updated_at
    before update on public.ics_sources
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'ics_sources_set_created_by'
  ) then
    create trigger ics_sources_set_created_by
    before insert on public.ics_sources
    for each row execute function public.set_created_by();
  end if;
end $$;

alter table public.ics_sources enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'ics_sources' and policyname = 'ics_sources_posel'
  ) then
    create policy ics_sources_posel
    on public.ics_sources for all
    to authenticated
    using  (public.is_posel() and public.is_aal2())
    with check (public.is_posel() and public.is_aal2());
  end if;
end $$;

-- ===== EVENTS: nowe kolumny =====
alter table public.events
  add column if not exists ics_uid       text,
  add column if not exists ics_source_id uuid references public.ics_sources(id) on delete set null;

create index if not exists events_ics_source_idx on public.events(ics_source_id)
  where ics_source_id is not null;

create unique index if not exists events_ics_dedup_idx on public.events(ics_uid, ics_source_id)
  where ics_uid is not null and ics_source_id is not null;

-- ===== RPC: sync_ics_events =====
create or replace function public.sync_ics_events(
  p_source_id uuid,
  p_user_id   uuid,
  p_events    jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_event      jsonb;
  v_count      integer := 0;
  v_starts_at  timestamptz;
  v_ends_at    timestamptz;
begin
  if not exists (select 1 from public.ics_sources where id = p_source_id) then
    raise exception 'ICS source % not found', p_source_id;
  end if;

  for v_event in select * from jsonb_array_elements(p_events)
  loop
    v_starts_at := (v_event->>'starts_at')::timestamptz;
    v_ends_at   := nullif(v_event->>'ends_at', '')::timestamptz;

    if v_ends_at is not null and v_ends_at <= v_starts_at then
      v_ends_at := null;
    end if;

    insert into public.events (
      title, description, type, starts_at, ends_at, all_day,
      location, is_public, ics_uid, ics_source_id, created_by
    ) values (
      v_event->>'title',
      nullif(v_event->>'description', ''),
      'inne'::public.event_type,
      v_starts_at,
      v_ends_at,
      coalesce((v_event->>'all_day')::boolean, false),
      nullif(v_event->>'location', ''),
      false,
      v_event->>'uid',
      p_source_id,
      p_user_id
    )
    on conflict (ics_uid, ics_source_id)
    where ics_uid is not null and ics_source_id is not null
    do update set
      title       = excluded.title,
      description = excluded.description,
      starts_at   = excluded.starts_at,
      ends_at     = excluded.ends_at,
      all_day     = excluded.all_day,
      location    = excluded.location,
      updated_at  = now();

    v_count := v_count + 1;
  end loop;

  update public.ics_sources set
    last_synced_at     = now(),
    synced_event_count = v_count
  where id = p_source_id;

  return v_count;
end;
$$;

revoke execute on function public.sync_ics_events(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant  execute on function public.sync_ics_events(uuid, uuid, jsonb)
  to service_role;

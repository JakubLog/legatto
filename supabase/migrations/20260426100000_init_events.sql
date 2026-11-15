-- ePosel - Faza 4: kalendarz wydarzen

-- ===== ENUM =====
create type public.event_type as enum ('spotkanie', 'wyjazd', 'media', 'inne');

-- ===== EVENTS =====
create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  type public.event_type not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text,
  powiat_id smallint references public.powiaty(id) on delete set null,
  gmina_id integer references public.gminy(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_starts_at_idx on public.events(starts_at);
create index events_type_idx on public.events(type);
create index events_assigned_idx on public.events(assigned_to);
create index events_case_idx on public.events(case_id) where case_id is not null;
create index events_contact_idx on public.events(contact_id) where contact_id is not null;
create index events_powiat_idx on public.events(powiat_id);
create index events_search_idx on public.events using gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(location, ''))
);

-- ===== TRIGGERY =====
create trigger events_set_updated_at
before update on public.events
for each row execute function public.set_updated_at();

create trigger events_set_created_by
before insert on public.events
for each row execute function public.set_created_by();

-- Walidacja czasu: ends_at > starts_at gdy oba podane
create or replace function public.validate_event_times()
returns trigger
language plpgsql
as $$
begin
  if new.ends_at is not null and new.ends_at <= new.starts_at then
    raise exception 'ends_at musi być później niż starts_at';
  end if;
  return new;
end;
$$;

create trigger events_validate_times
before insert or update on public.events
for each row execute function public.validate_event_times();

-- Walidacja: gmina musi należeć do powiatu
create or replace function public.validate_event_gmina()
returns trigger
language plpgsql
as $$
begin
  if new.gmina_id is not null and new.powiat_id is null then
    raise exception 'gmina_id wymaga powiat_id';
  end if;
  if new.gmina_id is not null and not exists (
    select 1 from public.gminy where id = new.gmina_id and powiat_id = new.powiat_id
  ) then
    raise exception 'Gmina % nie należy do powiatu %', new.gmina_id, new.powiat_id;
  end if;
  return new;
end;
$$;

create trigger events_validate_gmina
before insert or update on public.events
for each row execute function public.validate_event_gmina();

-- Audit
create or replace function public.event_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit(
      'event.create', 'event', new.id,
      jsonb_build_object('title', new.title, 'type', new.type, 'starts_at', new.starts_at)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.log_audit('event.update', 'event', new.id, jsonb_build_object('title', new.title));
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_audit('event.delete', 'event', old.id, jsonb_build_object('title', old.title));
    return old;
  end if;
  return null;
end;
$$;

create trigger events_audit
after insert or update or delete on public.events
for each row execute function public.event_audit_trigger();

-- ===== RLS =====
alter table public.events enable row level security;

create policy events_select_authenticated
on public.events for select
to authenticated
using (public.is_authenticated_active());

create policy events_insert_writer
on public.events for insert
to authenticated
with check (public.is_writer());

create policy events_update_writer
on public.events for update
to authenticated
using (public.is_writer())
with check (public.is_writer());

create policy events_delete_posel
on public.events for delete
to authenticated
using (public.is_posel());

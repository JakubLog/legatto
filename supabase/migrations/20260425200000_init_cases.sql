-- ePosel - Faza 3: sprawy wyborców + kategorie

-- ===== ENUMY =====
create type public.case_status as enum ('nowa', 'w_toku', 'oczekuje', 'załatwiona', 'odrzucona');
create type public.case_priority as enum ('low', 'normal', 'high', 'urgent');

-- ===== KATEGORIE =====
create table public.case_categories (
  id integer primary key generated always as identity,
  name text not null unique,
  slug text not null unique,
  color text,
  is_system boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index case_categories_system_idx on public.case_categories(is_system);

-- Seed (10 systemowych)
insert into public.case_categories (name, slug, color, is_system) values
  ('Zdrowie',             'zdrowie',             'red',    true),
  ('Edukacja',            'edukacja',            'blue',   true),
  ('Infrastruktura',      'infrastruktura',      'orange', true),
  ('Podatki i finanse',   'podatki',             'yellow', true),
  ('Polityka społeczna',  'polityka-społeczna',  'purple', true),
  ('Rolnictwo',           'rolnictwo',           'green',  true),
  ('Bezpieczeństwo',      'bezpieczeństwo',      'slate',  true),
  ('Mieszkalnictwo',      'mieszkalnictwo',      'teal',   true),
  ('Obywatelska',         'obywatelska',         'cyan',   true),
  ('Inne',                'inne',                'gray',   true);

-- ===== CASES =====
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status public.case_status not null default 'nowa',
  priority public.case_priority not null default 'normal',
  category_id integer references public.case_categories(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  reporter_name text,
  reporter_phone text,
  reporter_email text,
  powiat_id smallint references public.powiaty(id) on delete set null,
  gmina_id integer references public.gminy(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  due_date date,
  resolved_at timestamptz,
  resolution_notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cases_status_idx on public.cases(status);
create index cases_priority_idx on public.cases(priority);
create index cases_category_idx on public.cases(category_id);
create index cases_contact_idx on public.cases(contact_id);
create index cases_assigned_idx on public.cases(assigned_to);
create index cases_powiat_idx on public.cases(powiat_id);
create index cases_due_date_idx on public.cases(due_date) where due_date is not null;
create index cases_created_idx on public.cases(created_at desc);
create index cases_search_idx on public.cases using gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
);

-- ===== TRIGGERY =====
create trigger cases_set_updated_at
before update on public.cases
for each row execute function public.set_updated_at();

create trigger cases_set_created_by
before insert on public.cases
for each row execute function public.set_created_by();

-- Auto resolved_at
create or replace function public.cases_set_resolved_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' and new.status in ('załatwiona', 'odrzucona') then
    new.resolved_at = coalesce(new.resolved_at, now());
  end if;
  if tg_op = 'UPDATE' then
    if old.status not in ('załatwiona', 'odrzucona') and new.status in ('załatwiona', 'odrzucona') then
      new.resolved_at = coalesce(new.resolved_at, now());
    elsif old.status in ('załatwiona', 'odrzucona') and new.status not in ('załatwiona', 'odrzucona') then
      new.resolved_at = null;
    end if;
  end if;
  return new;
end;
$$;

create trigger cases_set_resolved_at
before insert or update on public.cases
for each row execute function public.cases_set_resolved_at();

-- Walidacja: gmina musi należeć do powiatu i wymaga powiat_id
create or replace function public.validate_case_gmina()
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

create trigger cases_validate_gmina
before insert or update on public.cases
for each row execute function public.validate_case_gmina();

-- Audit (oddzielny event status_change)
create or replace function public.case_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit(
      'case.create', 'case', new.id,
      jsonb_build_object('title', new.title, 'status', new.status, 'priority', new.priority)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      perform public.log_audit(
        'case.status_change', 'case', new.id,
        jsonb_build_object('from', old.status, 'to', new.status, 'title', new.title)
      );
    else
      perform public.log_audit('case.update', 'case', new.id, jsonb_build_object('title', new.title));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_audit(
      'case.delete', 'case', old.id,
      jsonb_build_object('title', old.title)
    );
    return old;
  end if;
  return null;
end;
$$;

create trigger cases_audit
after insert or update or delete on public.cases
for each row execute function public.case_audit_trigger();

-- ===== RLS CASE_CATEGORIES =====
alter table public.case_categories enable row level security;

create policy case_categories_select_authenticated
on public.case_categories for select
to authenticated
using (public.is_authenticated_active());

-- INSERT: writer; nie pozwalamy is_system=true z poziomu klienta
create policy case_categories_insert_writer
on public.case_categories for insert
to authenticated
with check (public.is_writer() and is_system = false);

-- UPDATE: tylko Poseł i tylko non-system
create policy case_categories_update_posel
on public.case_categories for update
to authenticated
using (public.is_posel() and is_system = false)
with check (public.is_posel() and is_system = false);

-- DELETE: tylko Poseł i tylko non-system
create policy case_categories_delete_posel
on public.case_categories for delete
to authenticated
using (public.is_posel() and is_system = false);

-- ===== RLS CASES =====
alter table public.cases enable row level security;

create policy cases_select_authenticated
on public.cases for select
to authenticated
using (public.is_authenticated_active());

create policy cases_insert_writer
on public.cases for insert
to authenticated
with check (public.is_writer());

create policy cases_update_writer
on public.cases for update
to authenticated
using (public.is_writer())
with check (public.is_writer());

create policy cases_delete_posel
on public.cases for delete
to authenticated
using (public.is_posel());

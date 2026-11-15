-- ePosel - Faza 2a: contacts + powiaty + gminy + seed okręgu 35

-- ===== ENUM =====
create type public.contact_type as enum ('wyborca', 'dziennikarz', 'samorządowiec', 'sołtys', 'inne');

-- ===== POWIATY =====
create table public.powiaty (
  id smallint primary key,
  name text not null unique,
  is_city boolean not null default false,
  lat numeric(8, 5) not null,
  lng numeric(8, 5) not null
);

insert into public.powiaty (id, name, is_city, lat, lng) values
  (1,  'm. Olsztyn',   true,  53.77840, 20.48010),
  (2,  'olsztyński',   false, 53.85000, 20.50000),
  (3,  'ełcki',        false, 53.82660, 22.36360),
  (4,  'giżycki',      false, 54.04360, 21.76910),
  (5,  'gołdapski',    false, 54.30840, 22.30680),
  (6,  'kętrzyński',   false, 54.07620, 21.37370),
  (7,  'mrągowski',    false, 53.87030, 21.30470),
  (8,  'nidzicki',     false, 53.35780, 20.42740),
  (9,  'olecki',       false, 54.03570, 22.50480),
  (10, 'piski',        false, 53.63080, 21.80860),
  (11, 'szczycieński', false, 53.56350, 20.98630),
  (12, 'węgorzewski',  false, 54.21270, 21.74090);

-- ===== GMINY =====
create table public.gminy (
  id integer primary key generated always as identity,
  powiat_id smallint not null references public.powiaty(id) on delete restrict,
  name text not null,
  type text not null check (type in ('miejska', 'wiejska', 'miejsko-wiejska')),
  unique (powiat_id, name)
);

create index gminy_powiat_idx on public.gminy(powiat_id);

-- m. Olsztyn (id=1)
insert into public.gminy (powiat_id, name, type) values
  (1, 'Olsztyn', 'miejska');

-- olsztyński (id=2)
insert into public.gminy (powiat_id, name, type) values
  (2, 'Barczewo',     'miejsko-wiejska'),
  (2, 'Biskupiec',    'miejsko-wiejska'),
  (2, 'Dobre Miasto', 'miejsko-wiejska'),
  (2, 'Dywity',       'wiejska'),
  (2, 'Gietrzwałd',   'wiejska'),
  (2, 'Jeziorany',    'miejsko-wiejska'),
  (2, 'Jonkowo',      'wiejska'),
  (2, 'Kolno',        'wiejska'),
  (2, 'Olsztynek',    'miejsko-wiejska'),
  (2, 'Purda',        'wiejska'),
  (2, 'Stawiguda',    'wiejska'),
  (2, 'Świątki',      'wiejska');

-- ełcki (id=3)
insert into public.gminy (powiat_id, name, type) values
  (3, 'Ełk (miasto)', 'miejska'),
  (3, 'Ełk (gmina)',  'wiejska'),
  (3, 'Kalinowo',     'wiejska'),
  (3, 'Prostki',      'wiejska'),
  (3, 'Stare Juchy',  'wiejska');

-- giżycki (id=4)
insert into public.gminy (powiat_id, name, type) values
  (4, 'Giżycko (miasto)', 'miejska'),
  (4, 'Giżycko (gmina)',  'wiejska'),
  (4, 'Kruklanki',        'wiejska'),
  (4, 'Miłki',            'wiejska'),
  (4, 'Ryn',              'miejsko-wiejska'),
  (4, 'Wydminy',          'wiejska');

-- gołdapski (id=5)
insert into public.gminy (powiat_id, name, type) values
  (5, 'Banie Mazurskie', 'wiejska'),
  (5, 'Dubeninki',       'wiejska'),
  (5, 'Gołdap',          'miejsko-wiejska');

-- kętrzyński (id=6)
insert into public.gminy (powiat_id, name, type) values
  (6, 'Kętrzyn (miasto)', 'miejska'),
  (6, 'Kętrzyn (gmina)',  'wiejska'),
  (6, 'Korsze',           'miejsko-wiejska'),
  (6, 'Reszel',           'miejsko-wiejska'),
  (6, 'Barciany',         'wiejska'),
  (6, 'Srokowo',          'wiejska');

-- mrągowski (id=7)
insert into public.gminy (powiat_id, name, type) values
  (7, 'Mrągowo (miasto)', 'miejska'),
  (7, 'Mrągowo (gmina)',  'wiejska'),
  (7, 'Mikołajki',        'miejsko-wiejska'),
  (7, 'Piecki',           'wiejska'),
  (7, 'Sorkwity',         'wiejska');

-- nidzicki (id=8)
insert into public.gminy (powiat_id, name, type) values
  (8, 'Nidzica',            'miejsko-wiejska'),
  (8, 'Janowiec Kościelny', 'wiejska'),
  (8, 'Janowo',             'wiejska'),
  (8, 'Kozłowo',            'wiejska');

-- olecki (id=9)
insert into public.gminy (powiat_id, name, type) values
  (9, 'Olecko',         'miejsko-wiejska'),
  (9, 'Kowale Oleckie', 'wiejska'),
  (9, 'Świętajno',      'wiejska'),
  (9, 'Wieliczki',      'wiejska');

-- piski (id=10)
insert into public.gminy (powiat_id, name, type) values
  (10, 'Pisz',         'miejsko-wiejska'),
  (10, 'Biała Piska',  'miejsko-wiejska'),
  (10, 'Orzysz',       'miejsko-wiejska'),
  (10, 'Ruciane-Nida', 'miejsko-wiejska');

-- szczycieński (id=11)
insert into public.gminy (powiat_id, name, type) values
  (11, 'Szczytno (miasto)', 'miejska'),
  (11, 'Szczytno (gmina)',  'wiejska'),
  (11, 'Pasym',             'miejsko-wiejska'),
  (11, 'Dźwierzuty',        'wiejska'),
  (11, 'Jedwabno',          'wiejska'),
  (11, 'Rozogi',            'wiejska'),
  (11, 'Świętajno',         'wiejska'),
  (11, 'Wielbark',          'wiejska');

-- węgorzewski (id=12)
insert into public.gminy (powiat_id, name, type) values
  (12, 'Węgorzewo', 'miejsko-wiejska'),
  (12, 'Budry',     'wiejska'),
  (12, 'Pozezdrze', 'wiejska');

-- ===== CONTACTS =====
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  type public.contact_type not null,
  first_name text not null,
  last_name text not null,
  function text,
  phone text,
  email text,
  powiat_id smallint not null references public.powiaty(id) on delete restrict,
  gmina_id integer references public.gminy(id) on delete set null,
  miejscowość text,
  street text,
  postal_code text,
  notes text,
  tags jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_type_idx on public.contacts(type);
create index contacts_powiat_idx on public.contacts(powiat_id);
create index contacts_gmina_idx on public.contacts(gmina_id);
create index contacts_created_idx on public.contacts(created_at desc);
create index contacts_search_idx on public.contacts using gin (
  to_tsvector('simple', coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(function, ''))
);

create trigger contacts_set_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();

-- Auto-fill created_by z auth.uid() przy insercie
create or replace function public.set_created_by()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is null then
    new.created_by = auth.uid();
  end if;
  return new;
end;
$$;

create trigger contacts_set_created_by
before insert on public.contacts
for each row execute function public.set_created_by();

-- Walidacja: gmina musi należeć do powiatu
create or replace function public.validate_contact_gmina()
returns trigger
language plpgsql
as $$
begin
  if new.gmina_id is not null then
    if not exists (
      select 1 from public.gminy
      where id = new.gmina_id and powiat_id = new.powiat_id
    ) then
      raise exception 'Gmina % nie należy do powiatu %', new.gmina_id, new.powiat_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger contacts_validate_gmina
before insert or update on public.contacts
for each row execute function public.validate_contact_gmina();

-- Audit trigger
create or replace function public.contact_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('contact.create', 'contact', new.id, jsonb_build_object('type', new.type, 'name', new.first_name || ' ' || new.last_name));
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.log_audit('contact.update', 'contact', new.id, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_audit('contact.delete', 'contact', old.id, jsonb_build_object('name', old.first_name || ' ' || old.last_name));
    return old;
  end if;
  return null;
end;
$$;

create trigger contacts_audit
after insert or update or delete on public.contacts
for each row execute function public.contact_audit_trigger();

-- ===== RLS POWIATY (słownik - read all, brak write) =====
alter table public.powiaty enable row level security;

create policy powiaty_select_authenticated
on public.powiaty for select
to authenticated
using (public.is_authenticated_active());

-- ===== RLS GMINY (słownik - read all, brak write) =====
alter table public.gminy enable row level security;

create policy gminy_select_authenticated
on public.gminy for select
to authenticated
using (public.is_authenticated_active());

-- ===== RLS CONTACTS =====
alter table public.contacts enable row level security;

-- SELECT: każdy aktywny user (wszystkie role)
create policy contacts_select_authenticated
on public.contacts for select
to authenticated
using (public.is_authenticated_active());

-- INSERT: poseł + pracownik
create policy contacts_insert_writer
on public.contacts for insert
to authenticated
with check (public.is_writer());

-- UPDATE: poseł + pracownik
create policy contacts_update_writer
on public.contacts for update
to authenticated
using (public.is_writer())
with check (public.is_writer());

-- DELETE: tylko poseł
create policy contacts_delete_posel
on public.contacts for delete
to authenticated
using (public.is_posel());

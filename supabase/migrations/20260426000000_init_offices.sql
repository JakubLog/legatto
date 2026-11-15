-- ePosel - Faza 1.1: Biura poselskie + przypisanie użytkownika do biura
-- Tabela offices + kolumna profiles.office_id (nullable, walidacja w Edge Function).

-- ===== OFFICES =====
create table public.offices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  address text,
  phone text,
  email text,
  is_main boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index offices_active_idx on public.offices(is_active) where is_active = true;

-- Tylko jedno biuro może być oznaczone jako główne (partial unique index)
create unique index offices_one_main_idx on public.offices(is_main) where is_main = true;

create trigger offices_set_updated_at
before update on public.offices
for each row execute function public.set_updated_at();

-- ===== RLS OFFICES =====
alter table public.offices enable row level security;

-- Każdy aktywny user widzi liste biur (potrzebne do prezentacji przypisań)
create policy offices_select_authenticated
on public.offices for select
to authenticated
using (public.is_authenticated_active());

-- Tylko Poseł zarządza biurami
create policy offices_insert_posel
on public.offices for insert
to authenticated
with check (public.is_posel());

create policy offices_update_posel
on public.offices for update
to authenticated
using (public.is_posel())
with check (public.is_posel());

create policy offices_delete_posel
on public.offices for delete
to authenticated
using (public.is_posel());

-- ===== PROFILES.OFFICE_ID =====
alter table public.profiles
  add column office_id uuid references public.offices(id) on delete set null;

create index profiles_office_idx on public.profiles(office_id);

-- Walidacja (rola != poseł wymaga office_id) jest realizowana w Edge Function admin-create-user.
-- Dzięki temu istniejące profile zostają z office_id = NULL i nie psujemy stanu.

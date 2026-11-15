-- ePosel - Faza 1: profile użytkowników + audit log + role + RLS
-- Role: poseł (admin), pracownik (write), asystent (read-only)

-- ===== ENUM ROL =====
create type public.app_role as enum ('posel', 'pracownik', 'asystent');

-- ===== PROFILES =====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role public.app_role not null default 'asystent',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles(role);
create index profiles_active_idx on public.profiles(is_active) where is_active = true;

-- Trigger updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- ===== HELPER FUNCTIONS =====
-- Pobranie roli aktualnego użytkownika (SECURITY DEFINER żeby uniknąć rekurencji RLS)
create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active = true
$$;

create or replace function public.is_posel()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'posel' and is_active = true
  )
$$;

create or replace function public.is_writer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('posel', 'pracownik') and is_active = true
  )
$$;

create or replace function public.is_authenticated_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  )
$$;

-- ===== RLS PROFILES =====
alter table public.profiles enable row level security;

-- Każdy aktywny użytkownik widzi wszystkie profile (potrzebne do prezentacji autorów zmian, przypisań, etc.)
create policy profiles_select_authenticated
on public.profiles for select
to authenticated
using (public.is_authenticated_active());

-- Tylko Poseł może tworzyć profile (przez Edge Function z service_role i tak, ale dla bezpieczeństwa)
create policy profiles_insert_posel
on public.profiles for insert
to authenticated
with check (public.is_posel());

-- Poseł może edytować wszystkich; użytkownik może edytować tylko full_name na swoim profilu
create policy profiles_update_posel
on public.profiles for update
to authenticated
using (public.is_posel())
with check (public.is_posel());

create policy profiles_update_self
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and role = (select role from public.profiles where id = auth.uid())
  and is_active = (select is_active from public.profiles where id = auth.uid())
);

-- Tylko Poseł usuwa (rzadko - preferujemy is_active=false)
create policy profiles_delete_posel
on public.profiles for delete
to authenticated
using (public.is_posel());

-- ===== AUDIT LOG =====
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  user_email text,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_user_idx on public.audit_log(user_id);
create index audit_log_entity_idx on public.audit_log(entity_type, entity_id);
create index audit_log_created_idx on public.audit_log(created_at desc);

alter table public.audit_log enable row level security;

-- Tylko Poseł czyta audit log
create policy audit_log_select_posel
on public.audit_log for select
to authenticated
using (public.is_posel());

-- Insert via SECURITY DEFINER funkcji (zwykli userzy nie wstawiają bezpośrednio)
-- Brak insert policy = żaden klient nie wstawi przez REST, tylko przez SECURITY DEFINER

create or replace function public.log_audit(
  p_action text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.audit_log (user_id, user_email, action, entity_type, entity_id, metadata)
  values (auth.uid(), v_email, p_action, p_entity_type, p_entity_id, p_metadata);
end;
$$;

grant execute on function public.log_audit(text, text, uuid, jsonb) to authenticated;

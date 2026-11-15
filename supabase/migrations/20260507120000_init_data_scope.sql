-- ePosel - Per-user data scope (zakres widocznosci modulow)
--
-- Idempotentna wersja: bezpieczna do ponownego uruchomienia. Jezeli czesc
-- obiektow juz istnieje (np. enum / kolumny po wczesniejszym, niepelnym
-- pushu) - migracja przejdzie bez bledu.
--
-- Modulow objetych: 4 (kontakty, sprawy, kalendarz, interpelacje).
-- 'own' = widac rekordy created_by = self (+ assigned_to dla cases/events).
-- 'all' = widac wszystko (default = backward compatible).
-- Posel ZAWSZE bypassuje scope (is_posel() w SELECT policy).

-- ============================================================================
-- 1. Enum data_scope (idempotent przez DO block)
-- ============================================================================
do $$ begin
  create type public.data_scope as enum ('own', 'all');
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- 2. Kolumny na profiles (default 'all' - backward compatible)
-- ============================================================================
alter table public.profiles
  add column if not exists scope_contacts        public.data_scope not null default 'all',
  add column if not exists scope_cases           public.data_scope not null default 'all',
  add column if not exists scope_events          public.data_scope not null default 'all',
  add column if not exists scope_interpellations public.data_scope not null default 'all';

-- ============================================================================
-- 3. Helpery RPC (SECURITY DEFINER + row_security off — wzor jak is_posel)
-- ============================================================================

create or replace function public.current_contacts_scope()
returns public.data_scope
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select coalesce(
    (select scope_contacts from public.profiles where id = auth.uid() and is_active = true),
    'all'::public.data_scope
  )
$$;

create or replace function public.current_cases_scope()
returns public.data_scope
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select coalesce(
    (select scope_cases from public.profiles where id = auth.uid() and is_active = true),
    'all'::public.data_scope
  )
$$;

create or replace function public.current_events_scope()
returns public.data_scope
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select coalesce(
    (select scope_events from public.profiles where id = auth.uid() and is_active = true),
    'all'::public.data_scope
  )
$$;

create or replace function public.current_interpellations_scope()
returns public.data_scope
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select coalesce(
    (select scope_interpellations from public.profiles where id = auth.uid() and is_active = true),
    'all'::public.data_scope
  )
$$;

revoke all on function public.current_contacts_scope()        from public, anon;
revoke all on function public.current_cases_scope()           from public, anon;
revoke all on function public.current_events_scope()          from public, anon;
revoke all on function public.current_interpellations_scope() from public, anon;

grant execute on function public.current_contacts_scope()        to authenticated;
grant execute on function public.current_cases_scope()           to authenticated;
grant execute on function public.current_events_scope()          to authenticated;
grant execute on function public.current_interpellations_scope() to authenticated;

-- ============================================================================
-- 4. Recreate SELECT policies (bypass dla Posla, scope=all lub created_by/assigned_to)
-- ============================================================================
-- Zachowujemy `is_authenticated_active() and is_aal2()` z `rls_aal2_hardening`,
-- dodajemy filtr scope.

-- ----- contacts -----
drop policy if exists contacts_select_authenticated on public.contacts;
create policy contacts_select_authenticated on public.contacts
  for select to authenticated
  using (
    is_authenticated_active()
    and is_aal2()
    and (
      is_posel()
      or current_contacts_scope() = 'all'
      or created_by = auth.uid()
    )
  );

-- ----- cases (assigned_to istnieje) -----
drop policy if exists cases_select_authenticated on public.cases;
create policy cases_select_authenticated on public.cases
  for select to authenticated
  using (
    is_authenticated_active()
    and is_aal2()
    and (
      is_posel()
      or current_cases_scope() = 'all'
      or created_by = auth.uid()
      or assigned_to = auth.uid()
    )
  );

-- ----- events (assigned_to istnieje) -----
drop policy if exists events_select_authenticated on public.events;
create policy events_select_authenticated on public.events
  for select to authenticated
  using (
    is_authenticated_active()
    and is_aal2()
    and (
      is_posel()
      or current_events_scope() = 'all'
      or created_by = auth.uid()
      or assigned_to = auth.uid()
    )
  );

-- ----- interpellations -----
drop policy if exists interpellations_select_authenticated on public.interpellations;
create policy interpellations_select_authenticated on public.interpellations
  for select to authenticated
  using (
    is_authenticated_active()
    and is_aal2()
    and (
      is_posel()
      or current_interpellations_scope() = 'all'
      or created_by = auth.uid()
    )
  );

-- ============================================================================
-- 5. profiles_update_self — dolozyc scope_* do blacklist (user nie zmienia sobie scope)
-- ============================================================================

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() and is_aal2())
  with check (
    id = auth.uid()
    and is_aal2()
    and email                 = (select email                 from public.profiles where id = auth.uid())
    and role                  = (select role                  from public.profiles where id = auth.uid())
    and is_active             = (select is_active             from public.profiles where id = auth.uid())
    and office_id             is not distinct from (select office_id             from public.profiles where id = auth.uid())
    and password_set          = (select password_set          from public.profiles where id = auth.uid())
    and privacy_pin_hash      is not distinct from (select privacy_pin_hash      from public.profiles where id = auth.uid())
    and created_at            = (select created_at            from public.profiles where id = auth.uid())
    and scope_contacts        = (select scope_contacts        from public.profiles where id = auth.uid())
    and scope_cases           = (select scope_cases           from public.profiles where id = auth.uid())
    and scope_events          = (select scope_events          from public.profiles where id = auth.uid())
    and scope_interpellations = (select scope_interpellations from public.profiles where id = auth.uid())
  );

-- ============================================================================
-- 6. Rozszerzenie get_all_users_admin o kolumny scope_*
-- ============================================================================

drop function if exists public.get_all_users_admin();

create or replace function public.get_all_users_admin()
returns table (
  id uuid,
  email text,
  full_name text,
  role public.app_role,
  is_active boolean,
  office_id uuid,
  phone text,
  avatar_url text,
  is_public boolean,
  password_set boolean,
  scope_contacts public.data_scope,
  scope_cases public.data_scope,
  scope_events public.data_scope,
  scope_interpellations public.data_scope,
  created_at timestamptz,
  updated_at timestamptz,
  office_name text,
  office_city text
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
#variable_conflict use_column
declare
  v_is_posel boolean;
begin
  -- Tabela aliasowana jako `p` zeby uniknac kolizji z OUT parametrami funkcji
  -- (id / role / is_active maja te same nazwy co kolumny - inaczej ERROR 42702).
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'posel' and p.is_active = true
  ) into v_is_posel;

  if not v_is_posel then
    raise exception 'Brak uprawnien (wymagana rola: posel)' using errcode = '42501';
  end if;

  return query
    select
      p.id, p.email, p.full_name, p.role, p.is_active, p.office_id,
      p.phone, p.avatar_url, p.is_public, p.password_set,
      p.scope_contacts, p.scope_cases, p.scope_events, p.scope_interpellations,
      p.created_at, p.updated_at,
      o.name, o.city
    from public.profiles p
    left join public.offices o on o.id = p.office_id
    order by p.created_at desc;
end;
$$;

grant execute on function public.get_all_users_admin() to authenticated;

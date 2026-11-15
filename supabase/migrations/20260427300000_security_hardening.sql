-- ePosel — Security Hardening (audit findings 2026-04-27)
--
-- 1. Ujednolica wartosc enum app_role na 'posel' (bez polskiego ł).
--    Powod: frontend (types.ts, permissions.ts, RoleGuard, Edge Functions)
--    porównuje z 'posel'. Niespójnosc powodowała ze isAdmin() zwracał false
--    dla wszystkich Posłów i admin sekcja byla zablokowana.
--
-- 2. Zaostrzenie RLS na profiles (dotad każdy zalogowany user widział wszystkie
--    profile + emaile -> phishing risk).
--
-- 3. Audit log: zablokowanie UPDATE i DELETE (niezmienny dziennik zmian).
--
-- 4. app_settings: SELECT tylko dla Posła (a nie dla wszystkich aktywnych).

-- ===== 1. ROLE ENUM RENAME (idempotent) =====
-- Postgres 15+ wspiera ALTER TYPE ... RENAME VALUE bez przepisywania danych.
-- Wykonuje sie tylko jesli stara wartosc istnieje (baza moze byc juz na 'posel'
-- jesli wczesniejsze migracje zaaplikowano w stanie sprzed lintera).
do $$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'app_role' and e.enumlabel = 'poseł'
  ) then
    alter type public.app_role rename value 'poseł' to 'posel';
  end if;
end $$;

-- Odtwarzamy funkcje SECURITY DEFINER ktore mialy zaszyte 'poseł' w predicate.
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

-- get_public_office_staff — sortowanie zaszyte 'poseł' w CASE.
-- Po RENAME VALUE musimy odtworzyc funkcje zeby CASE WHEN poprawnie zadzialal.
-- Zachowujemy 'role' w wynikach — frontend (PublicOfficeCard.tsx) pokazuje
-- ROLE_LABELS[role] na publicznej stronie biura (intencjonalnie, dla obywateli).
create or replace function public.get_public_office_staff(p_office_id uuid)
returns table (
  id uuid,
  full_name text,
  role public.app_role,
  phone text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.role, p.phone, p.avatar_url
  from public.profiles p
  inner join public.offices o on o.id = p.office_id
  where p.office_id = p_office_id
    and p.is_active = true
    and p.is_public = true
    and o.is_active = true
  order by
    case p.role when 'posel' then 1 when 'pracownik' then 2 else 3 end,
    p.full_name;
$$;

grant execute on function public.get_public_office_staff(uuid) to anon, authenticated;

-- ===== 2. PROFILES — zaostrzenie SELECT =====
-- Kazdy aktywny user widzi: (a) wlasny profil, (b) profile z tego samego biura,
-- (c) wszystkie profile gdy is_posel(). To zapobiega exposure listy emaili
-- pracownikow innych biur dla asystentow i pracownikow.
--
-- UWAGA: subquery `select office_id from profiles where id = auth.uid()` w policy
-- na tej samej tabeli powoduje rekursywne wywolanie RLS i infinite loop / pusty
-- wynik (zalogowany user nie widzi nawet siebie). Dlatego SECURITY DEFINER
-- helper `current_office_id()` ktora omija RLS przy odczycie wlasnego biura.
create or replace function public.current_office_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select office_id from public.profiles where id = auth.uid() and is_active = true
$$;

drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_select_self_or_office_or_posel on public.profiles;

create policy profiles_select_self_or_office_or_posel
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or public.is_posel()
  or (
    public.is_authenticated_active()
    and office_id is not null
    and office_id = public.current_office_id()
  )
);

-- ===== 3. AUDIT LOG — niezmiennosc =====
-- Brak DELETE/UPDATE policies = wszystko forbidden, ale dla jasności dodajemy
-- restrictive policies ktore explicite mowia FALSE.
drop policy if exists audit_log_no_update on public.audit_log;
drop policy if exists audit_log_no_delete on public.audit_log;

create policy audit_log_no_update
on public.audit_log for update
to authenticated
using (false)
with check (false);

create policy audit_log_no_delete
on public.audit_log for delete
to authenticated
using (false);

-- Dodatkowy index na user_email (audyt findings #16)
create index if not exists audit_log_email_idx on public.audit_log(user_email);

-- ===== 4. APP_SETTINGS — tylko Posel czyta =====
drop policy if exists app_settings_select_authenticated on public.app_settings;
drop policy if exists app_settings_select_posel on public.app_settings;

create policy app_settings_select_posel
on public.app_settings for select
to authenticated
using (public.is_posel());

-- ===== 5. GET_ASSIGNABLE_USERS — minimalne dane do dropdownow =====
-- Po zaostrzeniu RLS na profiles (SELECT tylko wlasny/biuro/posel) komponenty
-- ktore potrzebuja listy wszystkich userow do przypisan (CaseFormDialog, EventFormDialog,
-- filtry) musza miec specjalna funkcje bez wycieku emaila.
create or replace function public.get_assignable_users()
returns table (
  id uuid,
  full_name text,
  role public.app_role
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.role
  from public.profiles p
  where p.is_active = true
  order by p.full_name
$$;

grant execute on function public.get_assignable_users() to authenticated;

-- ===== 6. AUDIT TRIGGER na app_settings =====
-- Zmiany ustawien (np. visibility_alert_days) musza byc audytowane.
create or replace function public.app_settings_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('setting.create', 'setting', null,
      jsonb_build_object('key', new.key, 'value', new.value));
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.log_audit('setting.update', 'setting', null,
      jsonb_build_object('key', new.key, 'old_value', old.value, 'new_value', new.value));
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_audit('setting.delete', 'setting', null,
      jsonb_build_object('key', old.key, 'value', old.value));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists app_settings_audit on public.app_settings;
create trigger app_settings_audit
after insert or update or delete on public.app_settings
for each row execute function public.app_settings_audit_trigger();

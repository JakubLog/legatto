-- Pola publiczne pracowników widoczne na stronie biura
alter table public.profiles
  add column if not exists phone text,
  add column if not exists avatar_url text,
  add column if not exists is_public boolean not null default true;

comment on column public.profiles.phone is 'Telefon kontaktowy widoczny na publicznej stronie biura.';
comment on column public.profiles.avatar_url is 'URL avatara (publiczny). NULL = renderujemy initialki.';
comment on column public.profiles.is_public is 'Czy pracownik widoczny na publicznej liście pracowników biura. Default true.';

-- SECURITY DEFINER funkcja zwracająca tylko publiczne pola.
-- Dostępna dla anon - nie ujawnia email ani innych wrazliwych kolumn z profiles.
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
    p.full_name
$$;

grant execute on function public.get_public_office_staff(uuid) to anon, authenticated;

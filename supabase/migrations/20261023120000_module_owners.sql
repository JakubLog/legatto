-- ePosel - Podzial obowiazkow: opiekunowie modulow
--
-- Kazdy modul bez przypisan per rekord ma 1-2 osoby odpowiedzialne. Kontakty
-- nie maja opiekuna, Sprawy wyborcow maja assigned_to per sprawa.
-- Odczyt: kazdy aktywny uzytkownik z aal2. Zmiana: tylko RPC set_module_owners
-- (Posel/Administrator + aal2), atomowo dla calego modulu, z audytem.

create table if not exists public.module_owners (
  module     text        not null
    constraint module_owners_module_check
    check (module in ('kalendarz', 'teren', 'interpelacje', 'budzet')),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  position   smallint    not null
    constraint module_owners_position_check check (position in (1, 2)),
  created_at timestamptz not null default now(),
  primary key (module, user_id),
  constraint module_owners_module_position_key unique (module, position)
);

comment on table public.module_owners is
  'Opiekunowie modulow (1-2 osoby na modul). Zmiana wylacznie przez RPC set_module_owners.';

create index if not exists module_owners_user_idx on public.module_owners(user_id);

alter table public.module_owners enable row level security;

revoke all on public.module_owners from public, anon, authenticated;
grant select on public.module_owners to authenticated;
grant all on public.module_owners to service_role;

drop policy if exists module_owners_select_team on public.module_owners;
create policy module_owners_select_team
on public.module_owners for select
to authenticated
using (public.is_authenticated_active() and public.is_aal2());

-- Zastepuje opiekunow modulu. p_user_ids: 1-2 rozne, aktywne konta; kolejnosc = position.
create or replace function public.set_module_owners(p_module text, p_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_ids uuid[] := coalesce(p_user_ids, array[]::uuid[]);
  v_count integer := coalesce(array_length(v_ids, 1), 0);
  v_previous uuid[];
begin
  if not public.is_posel() then
    raise exception 'Brak uprawnien (wymagana rola: posel lub administrator)' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagane uwierzytelnienie dwuskladnikowe (aal2)' using errcode = '42501';
  end if;
  if p_module is null or p_module not in ('kalendarz', 'teren', 'interpelacje', 'budzet') then
    raise exception 'Nieznany modul: %', p_module using errcode = '22023';
  end if;
  if v_count < 1 or v_count > 2 then
    raise exception 'Modul musi miec jedna lub dwie osoby odpowiedzialne' using errcode = '22023';
  end if;
  if array_position(v_ids, null) is not null then
    raise exception 'Osoba odpowiedzialna nie moze byc pusta' using errcode = '22023';
  end if;
  if v_count = 2 and v_ids[1] = v_ids[2] then
    raise exception 'Te sama osoba nie moze byc przypisana dwa razy' using errcode = '22023';
  end if;
  if (
    select count(*) from public.profiles
    where id = any(v_ids) and is_active = true
  ) <> v_count then
    raise exception 'Osoba odpowiedzialna musi miec aktywne konto' using errcode = '22023';
  end if;

  select coalesce(array_agg(user_id order by position), array[]::uuid[])
  into v_previous
  from public.module_owners
  where module = p_module;

  if v_previous = v_ids then
    return;
  end if;

  delete from public.module_owners where module = p_module;
  insert into public.module_owners (module, user_id, position)
  select p_module, t.user_id, t.ord::smallint
  from unnest(v_ids) with ordinality as t(user_id, ord);

  perform public.log_audit(
    'module_owners.update', 'module_owners', null,
    jsonb_build_object('module', p_module, 'from', to_jsonb(v_previous), 'to', to_jsonb(v_ids))
  );
end;
$$;

revoke all on function public.set_module_owners(text, uuid[]) from public, anon;
grant execute on function public.set_module_owners(text, uuid[]) to authenticated;

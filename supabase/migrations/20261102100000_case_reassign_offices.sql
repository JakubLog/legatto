-- ePosel - Przepisanie sprawy na inną osobę (także z innego biura)
--
-- 1. get_assignable_users zwraca dodatkowo biuro osoby (office_id, office_name,
--    office_city), żeby w wyborze osoby było widać, z którego biura jest.
--    Lista nadal obejmuje WSZYSTKICH aktywnych użytkowników (wszystkie biura).
-- 2. case_audit_trigger loguje zmianę osoby przypisanej jako 'case.reassign'
--    (from/to), niezależnie od zmiany statusu.
--
-- Uprawnienia bez zmian: przepisać sprawę może każdy writer (cases_update_writer).

-- ============================================================================
-- 1. get_assignable_users + biuro (zmiana typu zwracanego wymaga DROP)
-- ============================================================================

drop function if exists public.get_assignable_users();

create function public.get_assignable_users()
returns table (
  id uuid,
  full_name text,
  role public.app_role,
  avatar_url text,
  office_id uuid,
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
begin
  if not (public.is_authenticated_active() and public.is_aal2()) then
    raise exception 'Brak uprawnien' using errcode = '42501';
  end if;

  return query
    select p.id, p.full_name, p.role, p.avatar_url, p.office_id, o.name, o.city
    from public.profiles p
    left join public.offices o on o.id = p.office_id
    where p.is_active = true
    order by p.full_name;
end;
$$;

revoke all on function public.get_assignable_users() from public, anon;
grant execute on function public.get_assignable_users() to authenticated;

-- ============================================================================
-- 2. Audyt przepisania sprawy
-- ============================================================================

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
    if old.assigned_to is distinct from new.assigned_to then
      perform public.log_audit(
        'case.reassign', 'case', new.id,
        jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to, 'title', new.title)
      );
    end if;
    if old.status is distinct from new.status then
      perform public.log_audit(
        'case.status_change', 'case', new.id,
        jsonb_build_object('from', old.status, 'to', new.status, 'title', new.title)
      );
    elsif old.assigned_to is not distinct from new.assigned_to then
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

revoke all on function public.case_audit_trigger() from public, anon, authenticated;

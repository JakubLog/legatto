-- ePosel - get_assignable_users z avatar_url
--
-- Rozszerzenie RPC get_assignable_users o kolumnę avatar_url - zeby UI
-- (CaseFormDialog, EventFormDialog, CreateInterpellationDialog, CasesFilters,
-- ContactsFilters, EventsFilters, InterpellationEditor) mogły renderować
-- prawdziwy avatar zamiast samych inicjałów.
--
-- Zmiana wstecznie kompatybilna: dodaje kolumnę, nie usuwa istniejących.

drop function if exists public.get_assignable_users();

create or replace function public.get_assignable_users()
returns table (
  id uuid,
  full_name text,
  role public.app_role,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.role, p.avatar_url
  from public.profiles p
  where p.is_active = true
  order by p.full_name
$$;

revoke all on function public.get_assignable_users() from public, anon;
grant execute on function public.get_assignable_users() to authenticated;

-- ePosel - Wskaznik zaangazowania na dashboardzie
--
-- get_my_engagement(): procent (0-100) aktywnosci wywolujacego wzgledem
-- najaktywniejszej aktywnej osoby w biurze w ostatnich 30 dniach. Lider = 100.
-- Aktywnosc = wpisy audit_log dotyczace pracy biura (sprawy, zalaczniki,
-- kontakty, wydarzenia, interpelacje, wydatki, zgloszenia). Pomijane: MFA,
-- PIN, ustawienia, konta, biura, OAuth/MCP (tokeny, mcp.tool_call bez encji).
-- audit_log czyta tylko Posel, wiec funkcja jest SECURITY DEFINER i zwraca
-- wylacznie wynik wywolujacego.

create or replace function public.get_my_engagement()
returns integer
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_mine bigint;
  v_max bigint;
begin
  if not public.is_authenticated_active() then
    raise exception 'Brak uprawnien' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagane uwierzytelnienie dwuskladnikowe (aal2)' using errcode = '42501';
  end if;

  select
    coalesce(max(t.actions) filter (where t.user_id = auth.uid()), 0),
    coalesce(max(t.actions), 0)
  into v_mine, v_max
  from (
    select a.user_id, count(*) as actions
    from public.audit_log a
    join public.profiles p on p.id = a.user_id and p.is_active = true
    where a.created_at >= now() - interval '30 days'
      and a.entity_type in (
        'case', 'case_attachment', 'contact', 'event', 'interpellation',
        'office_expense', 'expense', 'public_submission'
      )
    group by a.user_id
  ) t;

  if v_max = 0 then
    return 0;
  end if;
  return round(v_mine * 100.0 / v_max)::integer;
end;
$$;

revoke all on function public.get_my_engagement() from public, anon;
grant execute on function public.get_my_engagement() to authenticated;

-- ePosel - Puls Biura: trend aktywnosci wybranej osoby
--
-- get_person_pulse(user_id) - Posel/Administrator + aal2. Wiersz per miara:
--   active_days         dni z logowaniem albo uzyciem MCP (jak regula opiekunow w Pulsie)
--   actions             wpisy w dzienniku zmian (akcje w aplikacji i przez MCP)
--   events_created      wydarzenia dodane recznie (bez importu ICS)
--   cases_resolved      sprawy przypisane do osoby i zalatwione
--   interpellations     interpelacje wgrane przez osobe
--   expenses_added      wpisane wydatki
-- Okresy w czasie Europe/Warsaw, porownanie "do tego samego momentu":
--   this_week  = od poniedzialku do teraz,  prev_week  = poprzedni tydzien o tej samej dlugosci;
--   this_month = od 1. dnia do teraz,       prev_month = poprzedni miesiac o tej samej dlugosci
--                (najwyzej do konca poprzedniego miesiaca);
--   weekly     = 8 ostatnich tygodni (najstarszy pierwszy, ostatni = biezacy, niepelny).

create or replace function public.get_person_pulse(p_user_id uuid)
returns table (
  metric text,
  this_week integer,
  prev_week integer,
  this_month integer,
  prev_month integer,
  weekly integer[]
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
#variable_conflict use_column
declare
  v_local timestamp := now() at time zone 'Europe/Warsaw';
  v_week timestamp := date_trunc('week', v_local);
  v_prev_week timestamp := date_trunc('week', v_local) - interval '1 week';
  v_month timestamp := date_trunc('month', v_local);
  v_prev_month timestamp := date_trunc('month', v_local) - interval '1 month';
  v_prev_month_end timestamp;
  v_from timestamp;
  v_from_tz timestamptz;
begin
  if not public.is_posel() then
    raise exception 'Brak uprawnien (wymagana rola: posel lub administrator)' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagane uwierzytelnienie dwuskladnikowe (aal2)' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Nieznany uzytkownik' using errcode = '22023';
  end if;

  v_prev_month_end := least(v_prev_month + (v_local - v_month), v_month);
  v_from := least(v_prev_month, v_week - interval '7 weeks');
  v_from_tz := v_from at time zone 'Europe/Warsaw';

  return query
  with raw as (
    -- Aktywnosc: logowanie, sesje, MCP (jak module_owner_activity)
    select 'active_days'::text as m, e.created_at as at
    from auth.audit_log_entries e
    where e.payload ->> 'action' = 'login' and e.payload ->> 'actor_id' = p_user_id::text
      and e.created_at >= v_from_tz
    union all
    select 'active_days', s.created_at from auth.sessions s
    where s.user_id = p_user_id and s.created_at >= v_from_tz
    union all
    select 'active_days', s.refreshed_at at time zone 'UTC' from auth.sessions s
    where s.user_id = p_user_id and s.refreshed_at is not null
      and s.refreshed_at at time zone 'UTC' >= v_from_tz
    union all
    select 'active_days', a.created_at from public.audit_log a
    where a.user_id = p_user_id and a.created_at >= v_from_tz
      and (a.action like 'mcp.%' or a.metadata ->> 'via_mcp' = 'true')
    union all
    select 'active_days', k.last_used_at from public.mcp_tokens k
    where k.user_id = p_user_id and k.last_used_at >= v_from_tz
    union all
    select 'actions', a.created_at from public.audit_log a
    where a.user_id = p_user_id and a.created_at >= v_from_tz
    union all
    select 'events_created', e.created_at from public.events e
    where e.created_by = p_user_id and e.ics_uid is null and e.created_at >= v_from_tz
    union all
    select 'cases_resolved', c.resolved_at from public.cases c
    where c.assigned_to = p_user_id and c.resolved_at >= v_from_tz
    union all
    select 'interpellations', i.created_at from public.interpellations i
    where i.created_by = p_user_id and i.created_at >= v_from_tz
    union all
    select 'expenses_added', x.created_at from public.office_expenses x
    where x.created_by = p_user_id and x.created_at >= v_from_tz
  ),
  items as (
    -- Dni aktywnosci liczone raz na dzien; pozostale miary - kazde zdarzenie.
    select distinct r.m, date_trunc('day', r.at at time zone 'Europe/Warsaw') as ts
    from raw r where r.m = 'active_days'
    union all
    select r.m, r.at at time zone 'Europe/Warsaw' from raw r where r.m <> 'active_days'
  ),
  metrics(m, ord) as (
    values ('active_days', 1), ('actions', 2), ('events_created', 3),
           ('cases_resolved', 4), ('interpellations', 5), ('expenses_added', 6)
  )
  select
    mt.m,
    count(*) filter (where i.ts >= v_week and i.ts <= v_local)::integer,
    count(*) filter (where i.ts >= v_prev_week and i.ts < v_prev_week + (v_local - v_week))::integer,
    count(*) filter (where i.ts >= v_month and i.ts <= v_local)::integer,
    count(*) filter (where i.ts >= v_prev_month and i.ts < v_prev_month_end)::integer,
    array(
      select count(i2.ts)::integer
      from generate_series(7, 0, -1) as g(n)
      left join items i2
        on i2.m = mt.m
       and i2.ts >= v_week - make_interval(weeks => g.n)
       and i2.ts < v_week - make_interval(weeks => g.n) + interval '1 week'
      group by g.n
      order by g.n desc
    )
  from metrics mt
  left join items i on i.m = mt.m
  group by mt.m, mt.ord
  order by mt.ord;
end;
$$;

revoke all on function public.get_person_pulse(uuid) from public, anon;
grant execute on function public.get_person_pulse(uuid) to authenticated;

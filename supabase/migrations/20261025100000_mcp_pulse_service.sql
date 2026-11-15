-- ePosel - Puls Biura dla serwera MCP (service_role)
--
-- Serwer MCP (api/mcp.ts) laczy sie kluczem service_role, wiec w bazie nie ma auth.uid()
-- i get_module_pulse() / get_person_pulse() odrzucaja wywolanie (brak sesji, brak aal2).
-- Uprawnienia sprawdza warstwa MCP (rola z tokenu MCP), dlatego:
-- 1. Logika regul przeniesiona do funkcji wewnetrznych (bez grantow dla klientow):
--      module_pulse_core(p_details) - cialo get_module_pulse() z 20261023160000,
--      person_pulse_core(p_user_id) - cialo get_person_pulse() z 20261023180000
--                                     (razem z bledem 'Nieznany uzytkownik').
-- 2. get_module_pulse() i get_person_pulse() - te same sygnatury, kontrole uprawnien
--    i wynik; po kontroli wywoluja rdzen (jedna kopia regul).
-- 3. service_module_pulse() (zawsze ze szczegolami) i service_person_pulse(uuid)
--    - tylko service_role.

-- ===== 1. Rdzen: Puls Biura =====
create or replace function public.module_pulse_core(p_details boolean)
returns table (
  module text,
  level text,
  recent_count integer,
  baseline_avg numeric,
  reasons text[],
  owner_activity jsonb
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
#variable_conflict use_column
declare
  v_now timestamptz := now();
  v_recent_from timestamptz := now() - interval '14 days';
  v_base_from timestamptz := now() - interval '70 days';
  v_details boolean := coalesce(p_details, false);
  v_module text;
  v_recent integer;
  v_base integer;
  v_rule record;
  v_owner record;
  v_level integer;
  v_reasons text[];
  v_count integer;
  v_count2 integer;
  v_total integer;
  v_days integer;
  v_last timestamptz;
begin
  foreach v_module in array array['kalendarz', 'teren', 'interpelacje', 'budzet', 'newsletter'] loop
    v_recent := null;
    v_base := null;
    v_level := 0;
    v_reasons := array[]::text[];

    if v_module = 'kalendarz' then
      select
        count(*) filter (where e.created_at >= v_recent_from),
        count(*) filter (where e.created_at < v_recent_from)
      into v_recent, v_base
      from public.events e
      where e.ics_uid is null and e.created_at >= v_base_from;

      select count(*) into v_count
      from public.events e
      where e.starts_at >= v_now and e.starts_at < v_now + interval '14 days';
      if v_count = 0 then
        v_level := 1;
        v_reasons := v_reasons || 'Brak zaplanowanych wydarzeń na najbliższe 14 dni'::text;
      end if;

      select * into v_rule from public.module_pulse_decline(v_recent, v_base, 'Dodane wydarzenia');

    elsif v_module = 'teren' then
      select
        count(*) filter (where e.starts_at >= v_recent_from),
        count(*) filter (where e.starts_at < v_recent_from)
      into v_recent, v_base
      from public.events e
      where e.type in ('spotkanie', 'wyjazd')
        and e.powiat_id is not null
        and e.starts_at >= v_base_from
        and e.starts_at <= v_now;

      select coalesce((
        select (s.value #>> '{}')::integer from public.app_settings s where s.key = 'visibility_alert_days'
      ), 90) into v_days;

      select
        count(*),
        count(*) filter (where not exists (
          select 1 from public.events e
          where e.powiat_id = p.id
            and e.type in ('spotkanie', 'wyjazd')
            and e.starts_at <= v_now
            and e.starts_at > v_now - make_interval(days => v_days)
        ))
      into v_total, v_count
      from public.powiaty p;

      if v_total > 0 and v_count::numeric / v_total >= 0.25 then
        v_level := case when v_count::numeric / v_total >= 0.5 then 2 else 1 end;
        v_reasons := v_reasons || format('Powiaty bez obecności od ponad %s dni: %s z %s', v_days, v_count, v_total);
      end if;

      select * into v_rule from public.module_pulse_decline(v_recent, v_base, 'Spotkania i wyjazdy');

    elsif v_module = 'interpelacje' then
      select
        count(*) filter (where i.created_at >= v_recent_from),
        count(*) filter (where i.created_at < v_recent_from)
      into v_recent, v_base
      from public.interpellations i
      where i.created_at >= v_base_from;

      select
        count(*) filter (where i.deadline_at < v_now),
        count(*) filter (where i.deadline_at < v_now - interval '3 days')
      into v_count, v_count2
      from public.interpellations i
      where i.status = 'zaakceptowana';
      if v_count > 0 then
        v_level := greatest(v_level, case when v_count2 > 0 then 2 else 1 end);
        v_reasons := v_reasons || format('Zaakceptowane, niewysłane po terminie: %s', v_count);
      end if;

      select
        count(*) filter (where i.decided_at < v_now - interval '3 days'),
        count(*) filter (where i.decided_at < v_now - interval '7 days')
      into v_count, v_count2
      from public.interpellations i
      where i.status = 'uwagi';
      if v_count > 0 then
        v_level := greatest(v_level, case when v_count2 > 0 then 2 else 1 end);
        v_reasons := v_reasons || format('Uwagi Posła bez poprawek dłużej niż 3 dni: %s', v_count);
      end if;

      select * into v_rule from public.module_pulse_decline(v_recent, v_base, 'Wgrane interpelacje');

    elsif v_module = 'budzet' then
      select
        count(*) filter (where x.created_at >= v_recent_from),
        count(*) filter (where x.created_at >= v_base_from and x.created_at < v_recent_from),
        max(x.created_at)
      into v_recent, v_base, v_last
      from public.office_expenses x;

      if v_last is null then
        v_level := 1;
        v_reasons := v_reasons || 'Brak wpisów w rejestrze wydatków'::text;
      elsif v_last < v_now - interval '30 days' then
        v_level := case when v_last < v_now - interval '60 days' then 2 else 1 end;
        v_reasons := v_reasons || format('Ostatni wpis wydatku %s dni temu', extract(day from v_now - v_last)::integer);
      end if;

      select * into v_rule from public.module_pulse_decline(v_recent, v_base, 'Wpisane wydatki');

    else
      -- newsletter: wysylki ocenia frontend (GetResponse).
      select 0 as level, null::text as reason into v_rule;
    end if;

    -- Spadek aktywnosci w obszarze.
    v_level := greatest(v_level, v_rule.level);
    if v_rule.reason is not null then
      v_reasons := array[v_rule.reason] || v_reasons;
    end if;

    -- Aktywnosc opiekunow: logowanie albo MCP.
    select * into v_owner from public.module_owner_activity(v_module);
    v_level := greatest(v_level, v_owner.level);
    if v_owner.reason is not null then
      v_reasons := v_reasons || v_owner.reason;
    end if;

    module := v_module;
    level := (array['ok', 'warning', 'critical'])[v_level + 1];
    recent_count := case when v_details then v_recent end;
    baseline_avg := case when v_details and v_base is not null then round(v_base / 4.0, 1) end;
    reasons := case when v_details then v_reasons end;
    owner_activity := case when v_details then v_owner.owners end;
    return next;
  end loop;
end;
$$;

revoke all on function public.module_pulse_core(boolean) from public, anon, authenticated;

create or replace function public.get_module_pulse()
returns table (
  module text,
  level text,
  recent_count integer,
  baseline_avg numeric,
  reasons text[],
  owner_activity jsonb
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  if not (public.is_authenticated_active() and public.is_aal2()) then
    raise exception 'Brak uprawnien' using errcode = '42501';
  end if;

  -- Liczby, powody i aktywnosc opiekunow tylko Posel/Administrator.
  return query select * from public.module_pulse_core(public.is_posel());
end;
$$;

revoke all on function public.get_module_pulse() from public, anon;
grant execute on function public.get_module_pulse() to authenticated;

create or replace function public.service_module_pulse()
returns table (
  module text,
  level text,
  recent_count integer,
  baseline_avg numeric,
  reasons text[],
  owner_activity jsonb
)
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select * from public.module_pulse_core(true)
$$;

revoke all on function public.service_module_pulse() from public, anon, authenticated;
grant execute on function public.service_module_pulse() to service_role;

-- ===== 2. Rdzen: trend aktywnosci osoby =====
create or replace function public.person_pulse_core(p_user_id uuid)
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

revoke all on function public.person_pulse_core(uuid) from public, anon, authenticated;

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
begin
  if not public.is_posel() then
    raise exception 'Brak uprawnien (wymagana rola: posel lub administrator)' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagane uwierzytelnienie dwuskladnikowe (aal2)' using errcode = '42501';
  end if;

  return query select * from public.person_pulse_core(p_user_id);
end;
$$;

revoke all on function public.get_person_pulse(uuid) from public, anon;
grant execute on function public.get_person_pulse(uuid) to authenticated;

create or replace function public.service_person_pulse(p_user_id uuid)
returns table (
  metric text,
  this_week integer,
  prev_week integer,
  this_month integer,
  prev_month integer,
  weekly integer[]
)
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select * from public.person_pulse_core(p_user_id)
$$;

revoke all on function public.service_person_pulse(uuid) from public, anon, authenticated;
grant execute on function public.service_person_pulse(uuid) to service_role;

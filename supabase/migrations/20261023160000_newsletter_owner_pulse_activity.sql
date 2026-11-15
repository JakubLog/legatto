-- ePosel - Newsletter jako obszar z opiekunem + aktywnosc opiekunow w Pulsie Biura
--
-- Uzupelnia 20261023120000_module_owners i 20261023140000_module_pulse (juz wgrane):
-- 1. module_owners: obszar 'newsletter' (wysylka co tydzien).
-- 2. get_module_pulse(): wiersz takze dla newslettera + regula aktywnosci opiekunow
--    + kolumna owner_activity. Historie wysylek newslettera (GetResponse) dolicza
--    frontend - baza zna tylko aktywnosc opiekuna newslettera.
--
-- Regula aktywnosci opiekunow: dni z logowaniem ALBO uzyciem MCP w ostatnich 14 dniach
-- (logowania i sesje z auth, wywolania MCP z audit_log, last_used_at tokenow).
-- Liczy sie najaktywniejszy opiekun: <= 3 dni -> warning, <= 1 dzien -> critical.
-- Brak opiekuna -> warning. Pozostale reguly bez zmian (opis w 20261023140000).
-- Liczby, powody i aktywnosc opiekunow tylko Posel/Administrator (Puls Biura).

-- ===== 1. Newsletter w module_owners =====
alter table public.module_owners drop constraint if exists module_owners_module_check;
alter table public.module_owners
  add constraint module_owners_module_check
  check (module in ('kalendarz', 'teren', 'interpelacje', 'budzet', 'newsletter'));

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
  if p_module is null or p_module not in ('kalendarz', 'teren', 'interpelacje', 'budzet', 'newsletter') then
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

-- ===== 2. Puls Biura: aktywnosc opiekunow =====
-- Dni aktywnosci (logowanie albo MCP) opiekunow obszaru w ostatnich 14 dniach.
create or replace function public.module_owner_activity(p_module text)
returns table (level integer, reason text, owners jsonb)
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  with owner_rows as (
    select mo.user_id, mo.position, p.full_name
    from public.module_owners mo
    join public.profiles p on p.id = mo.user_id
    where mo.module = p_module
  ),
  activity as (
    select
      o.user_id,
      o.position,
      o.full_name,
      count(distinct (t.at at time zone 'Europe/Warsaw')::date)::integer as days,
      max(t.at) as last_at
    from owner_rows o
    left join lateral (
      select e.created_at as at
      from auth.audit_log_entries e
      where e.payload ->> 'action' = 'login' and e.payload ->> 'actor_id' = o.user_id::text
      union all
      select s.created_at from auth.sessions s where s.user_id = o.user_id
      union all
      select s.refreshed_at at time zone 'UTC' from auth.sessions s
      where s.user_id = o.user_id and s.refreshed_at is not null
      union all
      select a.created_at from public.audit_log a
      where a.user_id = o.user_id and (a.action like 'mcp.%' or a.metadata ->> 'via_mcp' = 'true')
      union all
      select k.last_used_at from public.mcp_tokens k
      where k.user_id = o.user_id and k.last_used_at is not null
    ) t on t.at >= now() - interval '14 days'
    group by o.user_id, o.position, o.full_name
  )
  select
    case
      when count(*) = 0 then 1
      when max(a.days) <= 1 then 2
      when max(a.days) <= 3 then 1
      else 0
    end,
    case
      when count(*) = 0 then 'Brak osoby odpowiedzialnej'
      when max(a.days) <= 3 then 'Mało logowań i użycia MCP przez opiekunów w ostatnich 14 dniach'
    end,
    coalesce(jsonb_agg(
      jsonb_build_object('user_id', a.user_id, 'full_name', a.full_name, 'active_days', a.days, 'last_active_at', a.last_at)
      order by a.position
    ) filter (where a.user_id is not null), '[]'::jsonb)
  from activity a
$$;

revoke all on function public.module_owner_activity(text) from public, anon, authenticated;

drop function if exists public.get_module_pulse();

create function public.get_module_pulse()
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
  v_details boolean := public.is_posel();
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
  if not (public.is_authenticated_active() and public.is_aal2()) then
    raise exception 'Brak uprawnien' using errcode = '42501';
  end if;

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

revoke all on function public.get_module_pulse() from public, anon;
grant execute on function public.get_module_pulse() to authenticated;

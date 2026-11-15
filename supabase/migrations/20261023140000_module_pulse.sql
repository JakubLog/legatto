-- ePosel - Puls Biura: sygnaly zaniedban per obszar
--
-- get_module_pulse() liczy poziom dla obszarow z danymi w bazie (kalendarz, teren,
-- interpelacje, budzet). Newsletter liczy frontend z historii wysylek GetResponse.
-- Poziom: ok | warning ("W ostatnim czasie oslabienie dzialan") | critical
-- ("Bardzo duzy spadek dzialan") = najgorsza z regul obszaru.
--
-- Regula wspolna (spadek aktywnosci): ostatnie 14 dni vs srednia na 14 dni z 8 tygodni
-- wczesniej. Liczona tylko, gdy srednia >= 1 (inaczej brak historii do porownania).
--   < 60% sredniej -> warning, <= 25% sredniej -> critical.
-- Reguly obszarow:
--   kalendarz    aktywnosc: wydarzenia dodane recznie (bez importu ICS);
--                brak wydarzen na najblizsze 14 dni -> warning.
--   teren        aktywnosc: spotkania/wyjazdy z powiatem, ktore sie odbyly;
--                powiaty bez obecnosci dluzej niz visibility_alert_days:
--                >= 25% -> warning, >= 50% -> critical.
--   interpelacje aktywnosc: wgrane interpelacje;
--                zaakceptowane niewyslane po terminie: jakakolwiek -> warning, > 3 dni -> critical;
--                uwagi Posla bez poprawek: > 3 dni -> warning, > 7 dni -> critical.
--   budzet       aktywnosc: wpisy wydatkow;
--                ostatni wpis > 30 dni temu albo brak wpisow -> warning, > 60 dni -> critical.
--
-- Poziom widzi kazdy aktywny uzytkownik z aal2 (poswiata awatarow opiekunow).
-- Liczby i powody tylko Posel/Administrator (Puls Biura) - agregaty omijaja data_scope.

create or replace function public.module_pulse_decline(p_recent integer, p_base_total integer, p_label text)
returns table (level integer, reason text)
language sql
immutable
set search_path = public
as $$
  with b as (select p_base_total / 4.0 as avg)
  select
    case
      when b.avg < 1 then 0
      when p_recent <= b.avg * 0.25 then 2
      when p_recent < b.avg * 0.6 then 1
      else 0
    end,
    case
      when b.avg >= 1 and p_recent < b.avg * 0.6 then
        format('%s w ostatnich 14 dniach: %s (wcześniej średnio %s na 14 dni)',
               p_label, p_recent, replace(to_char(b.avg, 'FM999990.0'), '.', ','))
    end
  from b
$$;

revoke all on function public.module_pulse_decline(integer, integer, text) from public, anon, authenticated;

create or replace function public.get_module_pulse()
returns table (
  module text,
  level text,
  recent_count integer,
  baseline_avg numeric,
  reasons text[]
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
  v_recent integer;
  v_base integer;
  v_decline record;
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

  -- ===== Kalendarz =====
  select
    count(*) filter (where e.created_at >= v_recent_from),
    count(*) filter (where e.created_at >= v_base_from and e.created_at < v_recent_from)
  into v_recent, v_base
  from public.events e
  where e.ics_uid is null and e.created_at >= v_base_from;

  select * into v_decline from public.module_pulse_decline(v_recent, v_base, 'Dodane wydarzenia');
  v_level := v_decline.level;
  v_reasons := array_remove(array[v_decline.reason], null);

  select count(*) into v_count
  from public.events e
  where e.starts_at >= v_now and e.starts_at < v_now + interval '14 days';
  if v_count = 0 then
    v_level := greatest(v_level, 1);
    v_reasons := v_reasons || 'Brak zaplanowanych wydarzeń na najbliższe 14 dni'::text;
  end if;

  module := 'kalendarz';
  level := (array['ok', 'warning', 'critical'])[v_level + 1];
  recent_count := case when v_details then v_recent end;
  baseline_avg := case when v_details then round(v_base / 4.0, 1) end;
  reasons := case when v_details then v_reasons end;
  return next;

  -- ===== Widocznosc w terenie =====
  select
    count(*) filter (where e.starts_at >= v_recent_from),
    count(*) filter (where e.starts_at < v_recent_from)
  into v_recent, v_base
  from public.events e
  where e.type in ('spotkanie', 'wyjazd')
    and e.powiat_id is not null
    and e.starts_at >= v_base_from
    and e.starts_at <= v_now;

  select * into v_decline from public.module_pulse_decline(v_recent, v_base, 'Spotkania i wyjazdy');
  v_level := v_decline.level;
  v_reasons := array_remove(array[v_decline.reason], null);

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
    v_level := greatest(v_level, case when v_count::numeric / v_total >= 0.5 then 2 else 1 end);
    v_reasons := v_reasons || format('Powiaty bez obecności od ponad %s dni: %s z %s', v_days, v_count, v_total);
  end if;

  module := 'teren';
  level := (array['ok', 'warning', 'critical'])[v_level + 1];
  recent_count := case when v_details then v_recent end;
  baseline_avg := case when v_details then round(v_base / 4.0, 1) end;
  reasons := case when v_details then v_reasons end;
  return next;

  -- ===== Interpelacje =====
  select
    count(*) filter (where i.created_at >= v_recent_from),
    count(*) filter (where i.created_at < v_recent_from)
  into v_recent, v_base
  from public.interpellations i
  where i.created_at >= v_base_from;

  select * into v_decline from public.module_pulse_decline(v_recent, v_base, 'Wgrane interpelacje');
  v_level := v_decline.level;
  v_reasons := array_remove(array[v_decline.reason], null);

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

  module := 'interpelacje';
  level := (array['ok', 'warning', 'critical'])[v_level + 1];
  recent_count := case when v_details then v_recent end;
  baseline_avg := case when v_details then round(v_base / 4.0, 1) end;
  reasons := case when v_details then v_reasons end;
  return next;

  -- ===== Budzet biura =====
  select
    count(*) filter (where x.created_at >= v_recent_from),
    count(*) filter (where x.created_at >= v_base_from and x.created_at < v_recent_from),
    max(x.created_at)
  into v_recent, v_base, v_last
  from public.office_expenses x;

  select * into v_decline from public.module_pulse_decline(v_recent, v_base, 'Wpisane wydatki');
  v_level := v_decline.level;
  v_reasons := array_remove(array[v_decline.reason], null);

  if v_last is null then
    v_level := greatest(v_level, 1);
    v_reasons := v_reasons || 'Brak wpisów w rejestrze wydatków'::text;
  elsif v_last < v_now - interval '30 days' then
    v_level := greatest(v_level, case when v_last < v_now - interval '60 days' then 2 else 1 end);
    v_reasons := v_reasons || format('Ostatni wpis wydatku %s dni temu', extract(day from v_now - v_last)::integer);
  end if;

  module := 'budzet';
  level := (array['ok', 'warning', 'critical'])[v_level + 1];
  recent_count := case when v_details then v_recent end;
  baseline_avg := case when v_details then round(v_base / 4.0, 1) end;
  reasons := case when v_details then v_reasons end;
  return next;
end;
$$;

revoke all on function public.get_module_pulse() from public, anon;
grant execute on function public.get_module_pulse() to authenticated;
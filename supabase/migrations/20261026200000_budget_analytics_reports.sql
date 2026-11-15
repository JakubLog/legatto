-- ePosel - Budzet biura: analityka i raporty AI
--
-- 1. budget_analytics_core(p_month) - jedna kopia regul analityki budzetu (liczy baza):
--    historia 12 miesiecy, tempo miesiaca, poprzedni miesiac do tego samego dnia, rok-do-daty,
--    kategorie, kontrahenci, koszty stale, nietypowo wysokie wydatki, mozliwe duplikaty,
--    oplaty/prowizje, drobne wydatki, metody platnosci, kompletnosc dokumentacji.
--    Wynik = BudgetAnalytics (src/integrations/supabase/types.ts). Bez grantow dla klientow.
--    get_budget_analytics(p_month) - authenticated (aktywny + aal2), potem rdzen.
--    service_budget_analytics(p_month) - tylko service_role (/api/poliai?op=budget-report).
--    Wzorzec jak Puls Biura (20261025100000_mcp_pulse_service.sql).
-- 2. budget_reports - raporty AI z migawka danych wejsciowych. Czytaja wszyscy z dostepem
--    do budzetu (jak office_expenses), usuwa Posel/Administrator, zapis tylko service_role.
--    Audyt usuniecia: budget.report_delete.
--
-- Plan: ai-lib/plans/2026-10-26-budzet-analityka-raporty-ai.md

-- ============================================================================
-- 1. ANALITYKA BUDZETU
-- ============================================================================

create or replace function public.budget_analytics_core(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_today date := (now() at time zone 'Europe/Warsaw')::date;
  v_start date;
  v_end date;            -- pierwszy dzien kolejnego miesiaca (wylacznie)
  v_prev_start date;
  v_is_current boolean;
  v_days_in_month integer;
  v_days_elapsed integer;
  v_prev_days integer;
  v_prev_to_date numeric;
  v_cur_to_date numeric;
  v_ytd_start date;
  v_ytd_end date;        -- wlacznie
  v_ytd numeric;
  v_ytd_prev numeric;
  v_months jsonb;
  v_categories jsonb;
  v_vendors jsonb;
  v_recurring jsonb;
  v_anomalies jsonb;
  v_duplicates jsonb;
  v_fees jsonb;
  v_small jsonb;
  v_methods jsonb;
  v_quality jsonb;
begin
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Nieprawidłowy miesiąc' using errcode = '22023';
  end if;

  v_start := to_date(p_month || '-01', 'YYYY-MM-DD');
  if v_start > date_trunc('month', v_today)::date then
    raise exception 'Miesiąc z przyszłości' using errcode = '22023';
  end if;

  v_end := (v_start + interval '1 month')::date;
  v_prev_start := (v_start - interval '1 month')::date;
  v_is_current := v_start = date_trunc('month', v_today)::date;
  v_days_in_month := v_end - v_start;
  v_days_elapsed := case when v_is_current then extract(day from v_today)::integer else v_days_in_month end;
  v_prev_days := v_start - v_prev_start;

  -- Poprzedni miesiac: do tego samego dnia (biezacy) albo caly (miniony).
  select coalesce(sum(x.amount), 0)
    into v_prev_to_date
    from public.office_expenses x
   where x.expense_date >= v_prev_start
     and x.expense_date < v_prev_start + case
       when v_is_current then least(v_days_elapsed, v_prev_days)
       else v_prev_days
     end;

  -- Wybrany miesiac do dzisiaj (biezacy; bez wydatkow z data przyszla) albo caly (miniony).
  select coalesce(sum(x.amount), 0)
    into v_cur_to_date
    from public.office_expenses x
   where x.expense_date >= v_start
     and x.expense_date < v_start + v_days_elapsed;

  -- Rok do daty i ten sam zakres rok wczesniej.
  v_ytd_start := date_trunc('year', v_start)::date;
  v_ytd_end := case when v_is_current then v_today else v_end - 1 end;

  select coalesce(sum(x.amount), 0)
    into v_ytd
    from public.office_expenses x
   where x.expense_date between v_ytd_start and v_ytd_end;

  select coalesce(sum(x.amount), 0)
    into v_ytd_prev
    from public.office_expenses x
   where x.expense_date between (v_ytd_start - interval '1 year')::date
                            and (v_ytd_end - interval '1 year')::date;

  -- 12 miesiecy konczacych sie na p_month, rosnaco, zera dla pustych.
  select coalesce(jsonb_agg(jsonb_build_object(
           'month', to_char(m.m, 'YYYY-MM'),
           'total', round(coalesce(s.total, 0), 2),
           'count', coalesce(s.cnt, 0)
         ) order by m.m), '[]'::jsonb)
    into v_months
    from generate_series(
           (v_start - interval '11 months')::timestamp,
           v_start::timestamp,
           interval '1 month'
         ) as m(m)
    left join lateral (
      select sum(x.amount) as total, count(*)::integer as cnt
        from public.office_expenses x
       where x.expense_date >= m.m::date
         and x.expense_date < (m.m + interval '1 month')::date
    ) s on true;

  -- Kategorie: wybrany miesiac, poprzedni i srednia z 3 miesiecy przed wybranym.
  with base as (
    select x.category_id, x.amount, x.expense_date
      from public.office_expenses x
     where x.expense_date >= (v_start - interval '3 months')::date
       and x.expense_date < v_end
  ), agg as (
    select b.category_id,
           coalesce(sum(b.amount) filter (where b.expense_date >= v_start), 0) as cur,
           coalesce(sum(b.amount) filter (where b.expense_date >= v_prev_start and b.expense_date < v_start), 0) as prev,
           coalesce(sum(b.amount) filter (where b.expense_date < v_start), 0) as sum3,
           (count(*) filter (where b.expense_date >= v_start))::integer as cnt
      from base b
     group by b.category_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.category_id,
           'name', coalesce(c.name, 'Bez kategorii'),
           'color', c.color,
           'current', round(a.cur, 2),
           'previous', round(a.prev, 2),
           'avg3', round(a.sum3 / 3, 2),
           'count', a.cnt
         ) order by a.cur desc, a.prev desc, coalesce(c.name, 'Bez kategorii')), '[]'::jsonb)
    into v_categories
    from agg a
    left join public.expense_categories c on c.id = a.category_id;

  -- Top 10 kontrahentow wybranego miesiaca (nazwa = pisownia z najnowszego wydatku).
  with base as (
    select lower(btrim(x.vendor)) as k, btrim(x.vendor) as name, x.amount, x.expense_date, x.created_at
      from public.office_expenses x
     where x.expense_date >= v_prev_start
       and x.expense_date < v_end
       and nullif(btrim(x.vendor), '') is not null
  ), agg as (
    select b.k,
           (array_agg(b.name order by b.expense_date desc, b.created_at desc))[1] as name,
           coalesce(sum(b.amount) filter (where b.expense_date >= v_start), 0) as cur,
           coalesce(sum(b.amount) filter (where b.expense_date < v_start), 0) as prev,
           (count(*) filter (where b.expense_date >= v_start))::integer as cnt
      from base b
     group by b.k
  ), top as (
    select a.*
      from agg a
     where a.cur > 0
     order by a.cur desc, a.prev desc, a.name
     limit 10
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'vendor', t.name,
           'current', round(t.cur, 2),
           'previous', round(t.prev, 2),
           'count', t.cnt
         ) order by t.cur desc, t.prev desc, t.name), '[]'::jsonb)
    into v_vendors
    from top t;

  -- Koszty stale: kontrahent w >= 3 roznych miesiacach z 6 (do p_month wlacznie).
  with base as (
    select lower(btrim(x.vendor)) as k, btrim(x.vendor) as name, x.amount, x.expense_date,
           x.created_at, x.category_id, date_trunc('month', x.expense_date)::date as m
      from public.office_expenses x
     where x.expense_date >= (v_start - interval '5 months')::date
       and x.expense_date < v_end
       and nullif(btrim(x.vendor), '') is not null
  ), monthly as (
    select b.k, b.m, sum(b.amount) as total
      from base b
     group by b.k, b.m
  ), stats as (
    select mo.k,
           count(*)::integer as months_present,
           avg(mo.total) as avg_amount,
           (array_agg(mo.total order by mo.m desc))[1] as last_amount
      from monthly mo
     group by mo.k
    having count(*) >= 3
  ), latest as (
    select b.k,
           (array_agg(b.name order by b.expense_date desc, b.created_at desc))[1] as name,
           (array_agg(b.category_id order by b.expense_date desc, b.created_at desc))[1] as category_id,
           max(b.expense_date) as last_date,
           bool_or(b.expense_date >= v_start) as in_current
      from base b
     group by b.k
  ), top as (
    select l.name, c.name as category, s.months_present, s.avg_amount, s.last_amount,
           l.last_date, l.in_current
      from stats s
      join latest l on l.k = s.k
      left join public.expense_categories c on c.id = l.category_id
     order by s.avg_amount desc, l.name
     limit 15
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'vendor', t.name,
           'category', t.category,
           'months_present', t.months_present,
           'avg_amount', round(t.avg_amount, 2),
           'last_amount', round(t.last_amount, 2),
           'last_date', to_char(t.last_date, 'YYYY-MM-DD'),
           'in_current', t.in_current
         ) order by t.avg_amount desc, t.name), '[]'::jsonb)
    into v_recurring
    from top t;

  -- Nietypowo wysokie: >= 200 zl i >= 2x mediany kategorii z 6 miesiecy przed p_month
  -- (min. 3 probki; wydatki bez kategorii porownywane miedzy soba).
  with hist as (
    select x.category_id,
           (percentile_cont(0.5) within group (order by x.amount))::numeric as med,
           count(*) as n
      from public.office_expenses x
     where x.expense_date >= (v_start - interval '6 months')::date
       and x.expense_date < v_start
     group by x.category_id
  ), top as (
    select x.id, x.title, x.amount, x.expense_date, c.name as category,
           nullif(btrim(x.vendor), '') as vendor, h.med, x.amount / h.med as ratio
      from public.office_expenses x
      join hist h on h.category_id is not distinct from x.category_id
      left join public.expense_categories c on c.id = x.category_id
     where x.expense_date >= v_start
       and x.expense_date < v_end
       and h.n >= 3
       and h.med > 0
       and x.amount >= 200
       and x.amount >= 2 * h.med
     order by ratio desc, x.amount desc
     limit 10
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'title', t.title,
           'amount', round(t.amount, 2),
           'expense_date', to_char(t.expense_date, 'YYYY-MM-DD'),
           'category', t.category,
           'vendor', t.vendor,
           'median', round(t.med, 2),
           'ratio', round(t.ratio, 2)
         ) order by t.ratio desc, t.amount desc), '[]'::jsonb)
    into v_anomalies
    from top t;

  -- Mozliwe duplikaty: ta sama kwota i kontrahent (bez kontrahenta - tytul), <= 7 dni,
  -- co najmniej jeden w p_month, oba od poczatku poprzedniego miesiaca.
  with base as (
    select x.id, x.title, nullif(btrim(x.vendor), '') as vendor, x.amount, x.expense_date,
           coalesce('v:' || lower(nullif(btrim(x.vendor), '')), 't:' || lower(btrim(x.title))) as k
      from public.office_expenses x
     where x.expense_date >= v_prev_start
       and x.expense_date < v_end + 7
  ), top as (
    select a.id as a_id, b.id as b_id, a.title, coalesce(a.vendor, b.vendor) as vendor, a.amount,
           a.expense_date as a_date, b.expense_date as b_date
      from base a
      join base b
        on a.id < b.id
       and a.amount = b.amount
       and a.k = b.k
       and abs(a.expense_date - b.expense_date) <= 7
     where (a.expense_date >= v_start and a.expense_date < v_end)
        or (b.expense_date >= v_start and b.expense_date < v_end)
     order by greatest(a.expense_date, b.expense_date) desc, a.amount desc
     limit 10
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'ids', jsonb_build_array(t.a_id, t.b_id),
           'title', t.title,
           'vendor', t.vendor,
           'amount', round(t.amount, 2),
           'dates', jsonb_build_array(to_char(t.a_date, 'YYYY-MM-DD'), to_char(t.b_date, 'YYYY-MM-DD'))
         ) order by greatest(t.a_date, t.b_date) desc, t.amount desc), '[]'::jsonb)
    into v_duplicates
    from top t;

  -- Oplaty, prowizje, odsetki, kary, abonamenty (tytul/opis/notatki).
  with top as (
    select x.id, x.title, x.amount, x.expense_date, nullif(btrim(x.vendor), '') as vendor
      from public.office_expenses x
     where x.expense_date >= v_start
       and x.expense_date < v_end
       and concat_ws(' ', x.title, x.description, x.notes)
           ~* 'prowizj|opłat|oplat|odset|kar[aey]|mandat|abonament|subskryp|monit|windyk|split|przewalut'
     order by x.amount desc, x.expense_date desc
     limit 20
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'title', t.title,
           'amount', round(t.amount, 2),
           'expense_date', to_char(t.expense_date, 'YYYY-MM-DD'),
           'vendor', t.vendor
         ) order by t.amount desc, t.expense_date desc), '[]'::jsonb)
    into v_fees
    from top t;

  -- Drobne wydatki (< 100 zl).
  select jsonb_build_object(
           'count', count(*)::integer,
           'total', round(coalesce(sum(x.amount), 0), 2)
         )
    into v_small
    from public.office_expenses x
   where x.expense_date >= v_start
     and x.expense_date < v_end
     and x.amount < 100;

  -- Metody platnosci (null = brak).
  with agg as (
    select x.payment_method, sum(x.amount) as total, count(*)::integer as cnt
      from public.office_expenses x
     where x.expense_date >= v_start
       and x.expense_date < v_end
     group by x.payment_method
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'method', a.payment_method,
           'total', round(a.total, 2),
           'count', a.cnt
         ) order by a.total desc, a.payment_method nulls last), '[]'::jsonb)
    into v_methods
    from agg a;

  -- Kompletnosc dokumentacji.
  select jsonb_build_object(
           'total_count', count(*)::integer,
           'no_receipt_count', (count(*) filter (where nullif(btrim(x.receipt_path), '') is null))::integer,
           'no_receipt_sum', round(coalesce(sum(x.amount) filter (where nullif(btrim(x.receipt_path), '') is null), 0), 2),
           'no_category_count', (count(*) filter (where x.category_id is null))::integer,
           'no_vendor_count', (count(*) filter (where nullif(btrim(x.vendor), '') is null))::integer,
           'no_invoice_count', (count(*) filter (where nullif(btrim(x.invoice_number), '') is null))::integer
         )
    into v_quality
    from public.office_expenses x
   where x.expense_date >= v_start
     and x.expense_date < v_end;

  return jsonb_build_object(
    'month', p_month,
    'as_of', to_char(v_today, 'YYYY-MM-DD'),
    'months', v_months,
    'current_to_date', round(v_cur_to_date, 2),
    'previous_to_date', round(v_prev_to_date, 2),
    'pace', jsonb_build_object('days_in_month', v_days_in_month, 'days_elapsed', v_days_elapsed),
    'ytd', jsonb_build_object(
      'year', to_char(v_start, 'YYYY'),
      'total', round(v_ytd, 2),
      'prev_year_same_period', round(v_ytd_prev, 2)
    ),
    'categories', v_categories,
    'vendors', v_vendors,
    'recurring', v_recurring,
    'anomalies', v_anomalies,
    'duplicates', v_duplicates,
    'fees', v_fees,
    'small_expenses', v_small,
    'payment_methods', v_methods,
    'data_quality', v_quality
  );
end;
$$;

revoke all on function public.budget_analytics_core(text) from public, anon, authenticated;

create or replace function public.get_budget_analytics(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  if not (public.is_authenticated_active() and public.is_aal2()) then
    raise exception 'Brak dostępu' using errcode = '42501';
  end if;

  return public.budget_analytics_core(p_month);
end;
$$;

revoke all on function public.get_budget_analytics(text) from public, anon;
grant execute on function public.get_budget_analytics(text) to authenticated;

create or replace function public.service_budget_analytics(p_month text)
returns jsonb
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select public.budget_analytics_core(p_month)
$$;

revoke all on function public.service_budget_analytics(text) from public, anon, authenticated;
grant execute on function public.service_budget_analytics(text) to service_role;

-- ============================================================================
-- 2. RAPORTY AI
-- ============================================================================

create table public.budget_reports (
  id uuid primary key default gen_random_uuid(),
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- Tresc raportu (BudgetReportContent).
  content jsonb not null,
  -- Migawka danych wejsciowych (BudgetAnalytics z chwili generowania).
  analytics jsonb not null,
  model text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index budget_reports_period_created_idx
  on public.budget_reports (period, created_at desc);

alter table public.budget_reports enable row level security;

create policy budget_reports_select_authenticated
  on public.budget_reports for select
  to authenticated
  using (public.is_authenticated_active() and public.is_aal2());

create policy budget_reports_delete_posel
  on public.budget_reports for delete
  to authenticated
  using (public.is_posel() and public.is_aal2());

-- Bez polityk INSERT/UPDATE: zapis tylko service_role (/api/poliai?op=budget-report).
revoke all on public.budget_reports from anon, authenticated;
grant select, delete on public.budget_reports to authenticated;

create or replace function public.budget_report_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_audit(
    'budget.report_delete', 'budget_report', old.id,
    jsonb_build_object('period', old.period, 'model', old.model)
  );
  return old;
end;
$$;

revoke execute on function public.budget_report_audit_trigger() from public, anon, authenticated;

create trigger budget_reports_audit
after delete on public.budget_reports
for each row execute function public.budget_report_audit_trigger();

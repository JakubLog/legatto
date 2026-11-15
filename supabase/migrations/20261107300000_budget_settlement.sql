-- ePosel - Budżet biura: roczne podsumowanie i rozliczenie ryczałtu
--
-- Sprawozdanie z wydatkowania kwoty ryczałtu na prowadzenie biura poselskiego
-- (załącznik nr 3 do zarządzenia nr 8 Marszałka Sejmu z 25.09.2001, brzmienie z zarządzenia
-- nr 11 z 30.12.2025) grupuje wydatki w 22 pozycjach; pozycja 22 "Inne wydatki" ma
-- podpozycje 22.1-22.4 (art. spożywcze, kwiaty/wieńce, autostrady/parkingi, materiały
-- patriotyczne) i wiersz bez nazwy (22.5 = pozostałe).
--
-- 1. expense_categories.settlement_item - pozycja sprawozdania przypisana do kategorii
--    (null = nieprzypisana). Seed: kategorie z prefiksem "NN." w nazwie (konwencja z prod,
--    np. "16. Najem lokalu biura") oraz jednoznaczne kategorie systemowe.
-- 2. set_expense_category_settlement_item(category_id, item) - zmiana przypisania
--    (Poseł/Administrator + aal2). Osobne RPC, bo polityka UPDATE na expense_categories
--    blokuje kategorie systemowe (ochrona nazwy), a przypisanie mają mieć wszystkie.
--    Audyt: expense_category.settlement.
-- 3. get_budget_year_summary(p_year) - sumy roku per kategoria, braki faktur, wydatki
--    pozycji 19 (wykaz składników majątkowych). Okres: 1 stycznia - dziś (bieżący rok,
--    Europe/Warsaw) lub 31 grudnia. Liczone w bazie - lista wydatków w UI ma limit 500.

-- ============================================================================
-- 1. Pozycja sprawozdania na kategorii
-- ============================================================================

alter table public.expense_categories
  add column if not exists settlement_item text;

alter table public.expense_categories
  drop constraint if exists expense_categories_settlement_item_valid;
alter table public.expense_categories
  add constraint expense_categories_settlement_item_valid check (
    settlement_item is null
    or settlement_item in (
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11',
      '12', '13', '14', '15', '16', '17', '18', '19', '20', '21',
      '22.1', '22.2', '22.3', '22.4', '22.5'
    )
  );

comment on column public.expense_categories.settlement_item is
  'Pozycja sprawozdania z wydatkowania ryczałtu (1-21, 22.1-22.5); null = nieprzypisana.';

-- Seed A: nazwa zaczyna się numerem pozycji ("02. Umowy cywilnoprawne", "22. Inne wydatki").
update public.expense_categories c
set settlement_item = case when p.n = 22 then '22.5' else p.n::text end
from (
  select id, (substring(name from '^\s*(\d{1,2})\s*[.)]'))::int as n
  from public.expense_categories
) p
where p.id = c.id
  and c.settlement_item is null
  and p.n between 1 and 22;

-- Seed B: jednoznaczne kategorie systemowe. "Transport / Paliwo" (poz. 9/10/11) i
-- "Catering / Reprezentacja" (poz. 8/22.1) zależą od charakteru wydatku - przypisuje Poseł.
update public.expense_categories c
set settlement_item = v.item
from (values
  ('czynsz-i-media', '16'),
  ('materialy-biurowe', '20'),
  ('sprzet-biurowy', '19'),
  ('wynagrodzenia', '1'),
  ('komunikacja', '6'),
  ('druk-materialy-promo', '7'),
  ('inne', '22.5')
) as v(slug, item)
where c.slug = v.slug
  and c.is_system
  and c.settlement_item is null;

-- ============================================================================
-- 2. Zmiana przypisania (Poseł/Administrator)
-- ============================================================================

create or replace function public.set_expense_category_settlement_item(
  p_category_id integer,
  p_item text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_item text := nullif(btrim(coalesce(p_item, '')), '');
  v_old text;
  v_name text;
begin
  if not (public.is_posel() and public.is_aal2()) then
    raise exception 'Brak uprawnień' using errcode = '42501';
  end if;

  select settlement_item, name into v_old, v_name
  from public.expense_categories
  where id = p_category_id
  for update;

  if not found then
    raise exception 'Nie znaleziono kategorii' using errcode = 'P0002';
  end if;

  if v_old is not distinct from v_item then
    return;
  end if;

  -- Niepoprawny kod odrzuca constraint expense_categories_settlement_item_valid.
  update public.expense_categories
  set settlement_item = v_item
  where id = p_category_id;

  perform public.log_audit(
    'expense_category.settlement', 'expense_category', null,
    jsonb_build_object('category_id', p_category_id, 'name', v_name, 'old', v_old, 'new', v_item)
  );
end;
$$;

revoke all on function public.set_expense_category_settlement_item(integer, text) from public, anon;
grant execute on function public.set_expense_category_settlement_item(integer, text) to authenticated;

-- ============================================================================
-- 3. Podsumowanie roku
-- ============================================================================

create or replace function public.get_budget_year_summary(p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_today date := (now() at time zone 'Europe/Warsaw')::date;
  v_from date;
  v_to date;  -- włącznie
  v_totals jsonb;
  v_categories jsonb;
  v_fixed_assets jsonb;
begin
  if not (public.is_authenticated_active() and public.is_aal2()) then
    raise exception 'Brak dostępu' using errcode = '42501';
  end if;

  if p_year is null or p_year < 2000 or p_year > extract(year from v_today)::int then
    raise exception 'Nieprawidłowy rok' using errcode = '22023';
  end if;

  v_from := make_date(p_year, 1, 1);
  v_to := least(make_date(p_year, 12, 31), v_today);

  select jsonb_build_object(
    'total', coalesce(sum(e.amount), 0),
    'count', count(*),
    'missing_invoice_count', count(*) filter (where e.missing_invoice_file),
    'missing_invoice_total', coalesce(sum(e.amount) filter (where e.missing_invoice_file), 0)
  )
  into v_totals
  from public.office_expenses e
  where e.expense_date between v_from and v_to;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.total desc), '[]'::jsonb)
  into v_categories
  from (
    select
      e.category_id,
      sum(e.amount) as total,
      count(*) as count,
      count(*) filter (where e.missing_invoice_file) as missing_invoice_count
    from public.office_expenses e
    where e.expense_date between v_from and v_to
    group by e.category_id
  ) t;

  -- Wykaz składników majątkowych (pozycja 19 sprawozdania).
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.expense_date, t.title), '[]'::jsonb)
  into v_fixed_assets
  from (
    select e.id, e.title, e.expense_date, e.invoice_number, e.vendor, e.amount
    from public.office_expenses e
    join public.expense_categories c on c.id = e.category_id
    where e.expense_date between v_from and v_to
      and c.settlement_item = '19'
  ) t;

  return jsonb_build_object(
    'year', p_year,
    'date_from', v_from,
    'date_to', v_to,
    'as_of', v_today,
    'categories', v_categories,
    'fixed_assets', v_fixed_assets
  ) || v_totals;
end;
$$;

revoke all on function public.get_budget_year_summary(integer) from public, anon;
grant execute on function public.get_budget_year_summary(integer) to authenticated;

-- Etykiety enumow jak w migracjach i kodzie (z polskimi znakami).
--
-- Produkcja ma wartosci bez polskich znakow (case_status 'zalatwiona', contact_type
-- 'samorzadowiec' / 'soltys') - powstaly z wczesniejszej wersji migracji init. Aplikacja i
-- narzedzia MCP/PoliAI wysylaja 'załatwiona', 'samorządowiec', 'sołtys', wiec zamkniecie
-- sprawy i zapis kontaktu tego typu konczyly sie bledem "invalid input value for enum".
-- RENAME VALUE zachowuje OID typu i istniejace wiersze; na bazach z poprawnymi etykietami
-- migracja nic nie zmienia.

do $$
begin
  if exists (select 1 from pg_enum where enumtypid = 'public.case_status'::regtype and enumlabel = 'zalatwiona') then
    alter type public.case_status rename value 'zalatwiona' to 'załatwiona';
  end if;
  if exists (select 1 from pg_enum where enumtypid = 'public.contact_type'::regtype and enumlabel = 'samorzadowiec') then
    alter type public.contact_type rename value 'samorzadowiec' to 'samorządowiec';
  end if;
  if exists (select 1 from pg_enum where enumtypid = 'public.contact_type'::regtype and enumlabel = 'soltys') then
    alter type public.contact_type rename value 'soltys' to 'sołtys';
  end if;
end;
$$;

-- Trigger porownywal status z literalem 'zalatwiona' - po zmianie nazwy rzutowanie literalu
-- na enum by sie nie udalo. Tresc jak w 20260425200000_init_cases.sql (+ search_path).
create or replace function public.cases_set_resolved_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status in ('załatwiona', 'odrzucona') then
    new.resolved_at = coalesce(new.resolved_at, now());
  end if;
  if tg_op = 'UPDATE' then
    if old.status not in ('załatwiona', 'odrzucona') and new.status in ('załatwiona', 'odrzucona') then
      new.resolved_at = coalesce(new.resolved_at, now());
    elsif old.status in ('załatwiona', 'odrzucona') and new.status not in ('załatwiona', 'odrzucona') then
      new.resolved_at = null;
    end if;
  end if;
  return new;
end;
$$;

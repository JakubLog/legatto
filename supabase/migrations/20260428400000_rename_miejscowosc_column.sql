-- ePosel — Rename miejscowość → miejscowosc
--
-- Używamy dynamicznego SQL-a żeby ominąć problem z enkodowaniem znaku ó
-- w pliku migracji vs. tym co jest faktycznie zapisane w katalogu PostgreSQL.

do $$
declare
  v_col text;
begin
  select column_name into v_col
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'contacts'
    and column_name ilike 'miejscowo%'
    and column_name <> 'miejscowosc';

  if v_col is not null then
    execute format('alter table public.contacts rename column %I to miejscowosc', v_col);
  end if;
end;
$$;

-- Kontrola ustawień bazy VPS biura, wykonywana przez migrator po migracjach. Nie jest migracją:
-- na Supabase Cloud/Vercel nie obowiązuje.
--
-- A5: funkcje i RPC wrażliwe tylko z powierzchni admin.app (nagłówek X-Legatto-Surface ustawiany
-- przez Caddy biura). Bez legatto.surface_enforce = on brak nagłówka oznacza zgodę (tryb Vercel).
-- Parametr ustawia serwer bazy (compose: `postgres -c legatto.surface_enforce=on`): rola `postgres`
-- migratora nie może ustawić parametru-placeholdera przez ALTER DATABASE (PG 15+, brak SUPERUSER).
do $$
begin
  if coalesce(current_setting('legatto.surface_enforce', true), '') <> 'on' then
    raise exception 'legatto.surface_enforce <> on: serwer bazy musi startować z -c legatto.surface_enforce=on (A5)';
  end if;
end
$$;

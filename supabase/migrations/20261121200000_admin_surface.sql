-- compat-n-1: safe
-- Legatto self-host (A5): powierzchnia admin.
--
-- Na VPS ta sama SPA i to samo API są dostępne pod dwoma hostami w tailnecie:
--   app.<domena>       - CRM (group:staff),            proxy ustawia X-Legatto-Surface: crm
--   admin.app.<domena> - panel i funkcje wrażliwe (tag:office-device), X-Legatto-Surface: admin
-- Caddy nadpisuje nagłówek wartością swojego listenera (klient nie może go podrobić), a ACL
-- Headscale wpuszcza na listener admin tylko urządzenia biura.
--
-- Funkcje wrażliwe (eksport danych dla posła, A13) wołają public.require_admin_surface():
--   - nagłówek 'admin'                                  -> dozwolone,
--   - nagłówek inny niż 'admin' (np. 'crm')             -> odmowa (42501),
--   - brak nagłówka i legatto.surface_enforce <> 'on'   -> dozwolone (tryb Vercel / Supabase Cloud),
--   - brak nagłówka i legatto.surface_enforce = 'on'    -> odmowa (VPS: żądanie ominęło proxy).
-- legatto.surface_enforce ustawia serwer bazy VPS (`postgres -c legatto.surface_enforce=on`);
-- migrator self-host sprawdza po migracjach, że jest włączone.
-- Edge Functions admin-* mają ten sam kontrakt w supabase/functions/_shared/surface.ts
-- (env LEGATTO_SURFACE_ENFORCE=1).

create or replace function public.request_surface()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(
    lower(btrim(coalesce(
      nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-legatto-surface',
      ''
    ))),
    ''
  )
$$;

comment on function public.request_surface() is
  'Wartość nagłówka X-Legatto-Surface bieżącego żądania PostgREST (crm|admin) albo null poza proxy VPS.';

create or replace function public.require_admin_surface()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_surface text := public.request_surface();
  v_enforce boolean := coalesce(current_setting('legatto.surface_enforce', true), '') = 'on';
begin
  if v_surface = 'admin' then
    return;
  end if;
  if v_surface is null and not v_enforce then
    return;
  end if;
  raise exception 'Operacja dostępna tylko w panelu administracyjnym (admin.app)'
    using errcode = '42501', hint = 'admin_surface_required';
end;
$$;

comment on function public.require_admin_surface() is
  'Rzuca 42501, gdy żądanie nie przyszło przez host admin (X-Legatto-Surface: admin). Zob. nagłówek migracji.';

revoke all on function public.request_surface() from public, anon;
revoke all on function public.require_admin_surface() from public, anon;
grant execute on function public.request_surface() to authenticated, service_role;
grant execute on function public.require_admin_surface() to authenticated, service_role;

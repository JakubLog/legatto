-- ePosel - treść publicznej strony instancji (jedna instancja = jeden poseł).
--
-- Konfiguracja instancji posła żyje w public.app_settings (ADR 026):
--   - 'site_identity' - tożsamość posła (imię i nazwisko, dopełniacz, tytuł, okręg,
--     serwis www, zdjęcie),
--   - 'homepage'      - treść strony głównej `/` i PublicLayout (SEO, belka promo,
--     linki zewnętrzne, hero, kolejność/widoczność sekcji, teksty sekcji, stopka).
-- Kształt JSON = zod `siteIdentitySchema` / `homepageSchema` w src/lib/siteContent.ts.
--
-- Dostęp:
--   - Odczyt publiczny (anon): RPC get_public_site_content() - SECURITY DEFINER,
--     zwraca wyłącznie te 2 klucze. Tabela app_settings pozostaje niewidoczna dla anon.
--   - Zapis: istniejące polityki app_settings_update_posel (is_posel() and is_aal2();
--     is_posel() obejmuje rolę administrator od 20261023100001) + restrykcyjna
--     app_settings_no_secret_keys (te klucze nie są sekretami, więc przechodzą).
--     Zmiany audytuje istniejący trigger app_settings_audit (setting.update,
--     old_value/new_value).
--   - Zdjęcia: bucket `site-assets` (publiczny URL, zapis Poseł/administrator + aal2).
--
-- Seed jest NEUTRALNY (puste obiekty): migracje są wspólne dla wszystkich instancji,
-- więc nie mogą nieść danych konkretnego posła. Wiersze muszą istnieć, bo panel zapisuje
-- przez UPDATE; puste obiekty frontend uzupełnia wartościami domyślnymi (parseSiteContent).
-- Treść konkretnej instancji: panel admina albo jednorazowy skrypt danych instancji.

-- ============================================================================
-- 1. Wiersze site_identity + homepage
-- ============================================================================

insert into public.app_settings (key, value)
values
  ('site_identity', '{}'::jsonb),
  ('homepage', '{}'::jsonb)
on conflict (key) do nothing;

-- ============================================================================
-- 2. RPC get_public_site_content() - publiczny odczyt (anon)
-- ============================================================================
-- Zwraca {identity, homepage}; brakujący klucz = pusty obiekt (frontend uzupełnia
-- wartościami domyślnymi w parseSiteContent). Nic poza tymi 2 kluczami nie wycieka.

create or replace function public.get_public_site_content()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'identity', coalesce((select s.value from public.app_settings s where s.key = 'site_identity'), '{}'::jsonb),
    'homepage', coalesce((select s.value from public.app_settings s where s.key = 'homepage'), '{}'::jsonb)
  )
$$;

revoke all on function public.get_public_site_content() from public;
grant execute on function public.get_public_site_content() to anon, authenticated;

-- ============================================================================
-- 3. Bucket site-assets - zdjęcia strony publicznej
-- ============================================================================
-- Path: homepage/{timestamp}.{ext} (zapis ograniczony do folderu homepage/). Bucket publiczny: pliki serwowane przez
-- /storage/v1/object/public/site-assets/... bez polityki SELECT (jak avatars po
-- 20260504000000 i newsletter-assets po 20261018210000) - bez anonimowego listowania.
-- SELECT dla Posła/administratora + aal2: storage.remove i upsert wymagają SELECT.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-assets',
  'site-assets',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "site_assets_select_posel" on storage.objects;
create policy "site_assets_select_posel"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'site-assets' and public.is_posel() and public.is_aal2());

drop policy if exists "site_assets_insert_posel" on storage.objects;
create policy "site_assets_insert_posel"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'site-assets'
    and (storage.foldername(name))[1] = 'homepage'
    and public.is_posel()
    and public.is_aal2()
  );

drop policy if exists "site_assets_update_posel" on storage.objects;
create policy "site_assets_update_posel"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'site-assets' and public.is_posel() and public.is_aal2())
  with check (
    bucket_id = 'site-assets'
    and (storage.foldername(name))[1] = 'homepage'
    and public.is_posel()
    and public.is_aal2()
  );

drop policy if exists "site_assets_delete_posel" on storage.objects;
create policy "site_assets_delete_posel"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'site-assets' and public.is_posel() and public.is_aal2());

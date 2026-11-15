-- ePosel - Kampanie e-mail (GetResponse): bucket assets + seed kluczy konfiguracyjnych
--
-- Zakres:
-- 1. Storage bucket 'newsletter-assets' (publiczny, 5 MB, image/*) - obrazy w newsletterach
--    musza byc publicznie dostepne, bo klient pocztowy pobiera je przy otwarciu maila.
--    Path: {user_id}/{timestamp}.{ext} (cache-buster, jak avatars).
-- 2. Seed wpisow w app_settings dla GetResponse (klucz API + default list + from-fields).
--    RLS app_settings juz Posel-only via aal2 (migracja 20260504300000_rls_aal2_hardening),
--    wiec klucze sa widoczne i edytowalne tylko z poziomu /biuro/admin/integracje przez Posla.
--    Pracownik wysylajacy kampanie nie potrzebuje dostepu do klucza - Edge Function
--    'getresponse-proxy' uzywa service_role do odczytu i wywolania GR API.

-- ============================================================================
-- 1. STORAGE BUCKET 'newsletter-assets' (publiczny)
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'newsletter-assets',
  'newsletter-assets',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- SELECT publiczny (klient poczty pobiera obraz bez auth)
drop policy if exists "newsletter_assets_public_read" on storage.objects;
create policy "newsletter_assets_public_read"
on storage.objects for select
to public
using (bucket_id = 'newsletter-assets');

-- INSERT - writer (Posel + Pracownik) z aal2, w swoim folderze
drop policy if exists "newsletter_assets_writer_upload" on storage.objects;
create policy "newsletter_assets_writer_upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'newsletter-assets'
  and public.is_writer()
  and public.is_aal2()
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- UPDATE - writer w swoim folderze (rzadko uzywane, nowy plik per upload jak avatars)
drop policy if exists "newsletter_assets_writer_update" on storage.objects;
create policy "newsletter_assets_writer_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'newsletter-assets'
  and public.is_writer()
  and public.is_aal2()
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- DELETE - wlasciciel pliku LUB Posel (sprzatanie po pracownikach)
drop policy if exists "newsletter_assets_delete_own_or_posel" on storage.objects;
create policy "newsletter_assets_delete_own_or_posel"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'newsletter-assets'
  and public.is_aal2()
  and (
    ((storage.foldername(name))[1] = auth.uid()::text and public.is_writer())
    or public.is_posel()
  )
);

-- ============================================================================
-- 2. SEED app_settings dla GetResponse
-- ============================================================================
-- Wszystkie wartosci jako jsonb stringi (text wartosc, parse w aplikacji).
-- Edytowalne z UI przez Posla (RLS app_settings_update_posel + aal2).

insert into public.app_settings (key, value) values
  ('getresponse_api_key',         '""'::jsonb),
  ('getresponse_default_list_id', '""'::jsonb),
  ('getresponse_from_field_id',   '""'::jsonb),
  ('getresponse_from_name',       '""'::jsonb),
  ('getresponse_from_email',      '""'::jsonb),
  ('getresponse_reply_to_email',  '""'::jsonb)
on conflict (key) do nothing;

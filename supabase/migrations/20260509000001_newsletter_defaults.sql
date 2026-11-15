-- Stałe newslettera: globalne wartości domyślne pre-wypełniające edytor kampanii.
-- Przechowywane jako jeden rekord JSONB w app_settings.
-- Edytowalne tylko przez Posła (UPDATE policy już istnieje: app_settings_update_posel).
-- Odczyt: writer + aal2 (Poseł + Pracownik) - dane publiczne, będą w treści maila.

-- ============================================================================
-- 1. Seed rekordu newsletter_defaults
-- ============================================================================

insert into public.app_settings (key, value)
values (
  'newsletter_defaults',
  '{
    "header_avatar_url": "",
    "footer_office_name": "",
    "footer_office_address": "",
    "footer_contact_email": "",
    "footer_privacy_url": "",
    "footer_social_x": "",
    "footer_social_facebook": "",
    "footer_social_instagram": "",
    "footer_social_tiktok": "",
    "footer_social_youtube": ""
  }'::jsonb
)
on conflict (key) do nothing;

-- ============================================================================
-- 2. SELECT dla writerów (Poseł + Pracownik) - wyłącznie klucz newsletter_defaults.
--    Nie daje dostępu do wrażliwych kluczy jak getresponse_api_key.
-- ============================================================================

drop policy if exists "app_settings_select_newsletter_defaults_writer" on public.app_settings;
create policy "app_settings_select_newsletter_defaults_writer"
on public.app_settings for select
to authenticated
using (
  key = 'newsletter_defaults'
  and public.is_writer()
  and public.is_aal2()
);

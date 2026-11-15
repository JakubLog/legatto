-- ePosel - Integracja AI (Claude) przez kredyty API z planu Claude Max
--
-- Klucz API z organizacji Claude Console podlinkowanej do planu Max posła
-- (claude.ai -> Settings -> Billing -> API credits -> Link organization).
-- Plan Max zasila te organizacje miesiecznymi kredytami, wiec wywolania AI
-- w ePosel sa oplacane z subskrypcji, a nie z osobnego konta API.
--
-- Klucze trzymane w app_settings - RLS Posel-only + aal2 (migracja
-- 20260504300000_rls_aal2_hardening). Pracownik generujacy szkic nie widzi
-- klucza: Edge Function 'ai-proxy' czyta go przez service_role.

insert into public.app_settings (key, value) values
  ('anthropic_api_key', '""'::jsonb),
  ('ai_model',          '"claude-sonnet-4-6"'::jsonb)
on conflict (key) do nothing;

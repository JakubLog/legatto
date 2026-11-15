-- Sekrety instancji w Supabase Vault (przegląd SAAS-8).
--
-- Klucze API instancji (anthropic_api_key, getresponse_api_key, resend_api_key) leżały jawnym
-- tekstem w public.app_settings, a prywatny klucz VAPID w public.notification_server_config.
-- Od tej migracji są zaszyfrowane w vault.secrets (klucz szyfrowania projektu poza bazą):
--   - nazwy sekretów: 'app_settings:<klucz>' oraz 'notifications:vapid_private_key',
--   - zapis klucza API: set_secret_setting (Poseł + aal2, ta sama sygnatura, granty i audyt),
--   - status bez wartości: get_secret_settings_status (ten sam kształt wyniku),
--   - odczyt wartości: service_get_secrets (tylko service_role: Vercel api/, Edge Functions),
--   - VAPID: service_store_vapid_keys (tylko service_role; pierwszy zapis wygrywa).
-- Wartości jawne są kopiowane do Vault i usuwane z tabel; CHECK na app_settings i usunięta
-- kolumna vapid_private_key nie pozwalają wrócić do zapisu jawnym tekstem.
--
-- Wdrożenie razem z kodem czytającym sekrety przez service_get_secrets (api/_lib/poliai/session.ts,
-- api/_lib/notifications/settings.ts, api/_lib/tools/briefing.ts, api/_lib/tools/settings.ts,
-- Edge Functions ai-proxy i getresponse-proxy). Stary kod po tej migracji nie widzi kluczy.
--
-- Uwaga: zrzut bazy odtworzony w innym projekcie Supabase nie odszyfruje vault.secrets
-- (inny klucz projektu) - klucze API trzeba wtedy wpisać ponownie w Integracjach, a klucze
-- VAPID zostaną wygenerowane od nowa (ponowna subskrypcja urządzeń).

-- ============================================================================
-- 1. Odczyt sekretów (service_role)
-- ============================================================================

-- Nazwa sekretu w Vault dla klucza logicznego; NULL = klucz spoza allow-listy.
create or replace function public.secret_vault_name(p_key text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_key in ('anthropic_api_key', 'getresponse_api_key', 'resend_api_key') then 'app_settings:' || p_key
    when p_key = 'vapid_private_key' then 'notifications:vapid_private_key'
  end;
$$;

revoke all on function public.secret_vault_name(text) from public, anon, authenticated;

-- Wartości skonfigurowanych sekretów; nieustawiony albo nieznany klucz = brak wiersza.
create or replace function public.service_get_secrets(p_keys text[])
returns table (key text, value text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select k.key, d.decrypted_secret
    from unnest(p_keys) as k(key)
    join vault.decrypted_secrets d on d.name = public.secret_vault_name(k.key)
   where d.decrypted_secret is not null
     and d.decrypted_secret <> '';
$$;

revoke all on function public.service_get_secrets(text[]) from public, anon, authenticated;
grant execute on function public.service_get_secrets(text[]) to service_role;

-- ============================================================================
-- 2. Zapis i status kluczy API (Poseł + aal2) - sygnatury i granty bez zmian
-- ============================================================================

-- Audyt jak dotąd robił trigger app_settings_audit (setting.create / update / delete, bez wartości).
create or replace function public.set_secret_setting(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_value text := btrim(p_value);
  v_name text;
  v_secret_id uuid;
  v_old text;
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_posel() then
    raise exception 'Brak uprawnien (wymagana rola: posel)' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  if p_key is null or p_key not in ('anthropic_api_key', 'getresponse_api_key', 'resend_api_key') then
    raise exception 'Niedozwolony klucz ustawienia' using errcode = '22023';
  end if;

  v_name := public.secret_vault_name(p_key);
  -- Równoległy pierwszy zapis tego samego klucza nie może trafić na unikalną nazwę w Vault.
  perform pg_advisory_xact_lock(hashtext(v_name));
  select d.id, d.decrypted_secret into v_secret_id, v_old
    from vault.decrypted_secrets d
   where d.name = v_name;

  if v_value is null or v_value = '' then
    if v_secret_id is not null then
      delete from vault.secrets where id = v_secret_id;
      perform public.log_audit('setting.delete', 'setting', null,
        jsonb_build_object('key', p_key, 'redacted', true));
    end if;
    return;
  end if;

  if length(v_value) > 1000 then
    raise exception 'Wartosc klucza jest za dluga (max 1000 znakow)' using errcode = '22023';
  end if;

  if v_secret_id is null then
    perform vault.create_secret(v_value, v_name, 'Klucz API instancji (set_secret_setting)');
    perform public.log_audit('setting.create', 'setting', null,
      jsonb_build_object('key', p_key, 'redacted', true, 'configured', true));
  else
    perform vault.update_secret(v_secret_id, v_value);
    perform public.log_audit('setting.update', 'setting', null,
      jsonb_build_object('key', p_key, 'redacted', true,
        'changed', v_old is distinct from v_value, 'configured', true));
  end if;
end;
$$;

revoke all on function public.set_secret_setting(text, text) from public, anon;
grant execute on function public.set_secret_setting(text, text) to authenticated;

create or replace function public.get_secret_settings_status()
returns table (key text, configured boolean, hint text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_posel() then
    raise exception 'Brak uprawnien (wymagana rola: posel)' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  return query
  select
    k.setting_key,
    v.secret_value is not null,
    case when v.secret_value is not null then '••••' || right(v.secret_value, 4) end
  from unnest(array['anthropic_api_key', 'getresponse_api_key', 'resend_api_key']) as k(setting_key)
  left join lateral (
    select nullif(btrim(d.decrypted_secret), '') as secret_value
      from vault.decrypted_secrets d
     where d.name = public.secret_vault_name(k.setting_key)
  ) v on true
  order by k.setting_key;
end;
$$;

revoke all on function public.get_secret_settings_status() from public, anon;
grant execute on function public.get_secret_settings_status() to authenticated;

-- ============================================================================
-- 3. Klucze VAPID (service_role): publiczny w tabeli, prywatny w Vault
-- ============================================================================

-- Zapisuje parę, jeśli instancja nie ma jeszcze kompletnej; zwraca parę obowiązującą
-- (równoległe wywołanie, które zapisało klucze pierwsze, wygrywa - blokada wiersza).
create or replace function public.service_store_vapid_keys(p_public_key text, p_private_key text)
returns table (public_key text, private_key text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_public text;
  v_private text;
  v_secret_id uuid;
begin
  if coalesce(btrim(p_public_key), '') = '' or coalesce(btrim(p_private_key), '') = '' then
    raise exception 'Brak kluczy VAPID' using errcode = '22023';
  end if;

  insert into public.notification_server_config (id) values (true) on conflict (id) do nothing;
  select c.vapid_public_key into v_public
    from public.notification_server_config c
   where c.id
     for update;
  select d.id, d.decrypted_secret into v_secret_id, v_private
    from vault.decrypted_secrets d
   where d.name = public.secret_vault_name('vapid_private_key');

  if coalesce(v_public, '') <> '' and coalesce(v_private, '') <> '' then
    return query select v_public, v_private;
    return;
  end if;

  if v_secret_id is null then
    perform vault.create_secret(p_private_key, public.secret_vault_name('vapid_private_key'),
      'Prywatny klucz VAPID (web push)');
  else
    perform vault.update_secret(v_secret_id, p_private_key);
  end if;
  update public.notification_server_config c
     set vapid_public_key = p_public_key, updated_at = now()
   where c.id;
  return query select p_public_key, p_private_key;
end;
$$;

revoke all on function public.service_store_vapid_keys(text, text) from public, anon, authenticated;
grant execute on function public.service_store_vapid_keys(text, text) to service_role;

-- ============================================================================
-- 4. Przeniesienie istniejących wartości i blokada jawnego zapisu
-- ============================================================================

do $$
declare
  r record;
  v_secret_id uuid;
  v_vapid text;
begin
  for r in
    select s.key, btrim(s.value #>> '{}') as secret_value
      from public.app_settings s
     where s.key in ('anthropic_api_key', 'getresponse_api_key', 'resend_api_key')
       and jsonb_typeof(s.value) = 'string'
  loop
    continue when r.secret_value = '';
    select id into v_secret_id from vault.secrets where name = public.secret_vault_name(r.key);
    if v_secret_id is null then
      perform vault.create_secret(r.secret_value, public.secret_vault_name(r.key),
        'Klucz API instancji (set_secret_setting)');
    else
      perform vault.update_secret(v_secret_id, r.secret_value);
    end if;
  end loop;

  select btrim(c.vapid_private_key) into v_vapid
    from public.notification_server_config c
   where c.id;
  if coalesce(v_vapid, '') <> '' then
    select id into v_secret_id from vault.secrets where name = public.secret_vault_name('vapid_private_key');
    if v_secret_id is null then
      perform vault.create_secret(v_vapid, public.secret_vault_name('vapid_private_key'),
        'Prywatny klucz VAPID (web push)');
    else
      perform vault.update_secret(v_secret_id, v_vapid);
    end if;
  end if;
end;
$$;

-- Bez wpisów setting.delete w audycie: klucze nie zostały usunięte, tylko przeniesione.
alter table public.app_settings disable trigger app_settings_audit;
delete from public.app_settings
 where key in ('anthropic_api_key', 'getresponse_api_key', 'resend_api_key');
alter table public.app_settings enable trigger app_settings_audit;

alter table public.app_settings drop constraint if exists app_settings_no_plaintext_secrets;
alter table public.app_settings
  add constraint app_settings_no_plaintext_secrets
  check (key not in ('anthropic_api_key', 'getresponse_api_key', 'resend_api_key'));

alter table public.notification_server_config drop column if exists vapid_private_key;

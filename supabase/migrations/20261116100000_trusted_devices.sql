-- Zaufane komputery: ekran wyboru profilu po wylogowaniu, logowanie PIN-em + 2FA bez hasła.
--
-- Model:
--   - Po pełnym logowaniu (hasło + TOTP, aal2) przeglądarka tworzy parę kluczy ECDSA P-256 z kluczem
--     prywatnym nieeksportowalnym (WebCrypto, IndexedDB). Baza zna tylko klucz publiczny (JWK).
--     Zaufanie wygasa 30 dni od rejestracji; każde logowanie hasłem rejestruje nowy klucz
--     w miejsce poprzedniego (p_replaces), więc 30 dni liczy się od ostatniego logowania hasłem.
--   - Logowanie z profilu (Edge Function device-login): jednorazowe wyzwanie (60 s) podpisane kluczem
--     urządzenia + PIN trybu prywatnego (privacy_pin_attempt: ten sam limit prób i blokada co przy
--     odsłanianiu ekranu) -> sesja aal1 -> zwykły ekran 2FA podnosi ją do aal2. Urządzenie i PIN same
--     nie dają dostępu do danych (RLS is_aal2(), aal2 w Edge Functions i Vercel).
--   - Tabela bez grantów dla klienta; właściciel (aktywne konto + aal2) używa wyłącznie RPC,
--     Edge Function - funkcji service_*.
--   - Odwołanie = DELETE wiersza. revoke_user_access() (dezaktywacja, "Wyloguj wszędzie", reset 2FA)
--     usuwa wszystkie urządzenia użytkownika. Wygasłe wiersze kasuje pg_cron (trusted-devices-retention).

-- ============================================================================
-- 1. Tabela
-- ============================================================================
create table if not exists public.trusted_devices (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles(id) on delete cascade,
  public_key           jsonb not null,
  label                text not null check (char_length(label) between 1 and 120),
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null default now() + interval '30 days',
  last_used_at         timestamptz,
  challenge            text,
  challenge_expires_at timestamptz
);

comment on table public.trusted_devices is
  'Zaufane przeglądarki (klucz publiczny ECDSA P-256) do logowania PIN-em + 2FA z ekranu wyboru profilu. Tylko RPC / service_role.';

create index if not exists trusted_devices_user_idx on public.trusted_devices (user_id);

alter table public.trusted_devices enable row level security;
revoke all on table public.trusted_devices from public, anon, authenticated;
grant all on table public.trusted_devices to service_role;

-- ============================================================================
-- 2. RPC właściciela (aktywne konto + aal2)
-- ============================================================================
create or replace function public.register_trusted_device(
  p_public_key jsonb,
  p_label text,
  p_replaces uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_uid uuid := auth.uid();
  v_label text := left(btrim(coalesce(p_label, '')), 120);
  v_id uuid;
  v_expires timestamptz;
begin
  if v_uid is null or not public.is_authenticated_active() or not public.is_aal2() then
    raise exception 'trusted_device_aal2_required' using errcode = '42501';
  end if;

  -- Tylko klucz publiczny P-256 (bez składowej prywatnej `d`).
  if p_public_key is null
     or jsonb_typeof(p_public_key) <> 'object'
     or p_public_key ->> 'kty' is distinct from 'EC'
     or p_public_key ->> 'crv' is distinct from 'P-256'
     or coalesce(p_public_key ->> 'x', '') !~ '^[A-Za-z0-9_-]{43}$'
     or coalesce(p_public_key ->> 'y', '') !~ '^[A-Za-z0-9_-]{43}$'
     or p_public_key ? 'd' then
    raise exception 'trusted_device_key_format' using errcode = '22023';
  end if;
  if v_label = '' then
    v_label := 'Przeglądarka';
  end if;

  delete from public.trusted_devices td
   where td.user_id = v_uid
     and (td.expires_at <= now() or td.id = p_replaces);

  insert into public.trusted_devices (user_id, public_key, label)
  values (
    v_uid,
    jsonb_build_object('kty', 'EC', 'crv', 'P-256', 'x', p_public_key ->> 'x', 'y', p_public_key ->> 'y'),
    v_label
  )
  returning id, expires_at into v_id, v_expires;

  -- Najwyżej 10 zaufanych przeglądarek na konto: najstarsze wypadają.
  delete from public.trusted_devices td
   where td.id in (
     select t.id from public.trusted_devices t
      where t.user_id = v_uid
      order by t.created_at desc
     offset 10
   );

  perform public.log_audit('trusted_device.register', 'trusted_device', v_id,
    jsonb_build_object('label', v_label, 'replaced', p_replaces is not null));

  return jsonb_build_object('id', v_id, 'expires_at', v_expires);
end;
$$;

revoke all on function public.register_trusted_device(jsonb, text, uuid) from public, anon;
grant execute on function public.register_trusted_device(jsonb, text, uuid) to authenticated;

create or replace function public.list_my_trusted_devices()
returns table (id uuid, label text, created_at timestamptz, last_used_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select td.id, td.label, td.created_at, td.last_used_at, td.expires_at
    from public.trusted_devices td
   where td.user_id = auth.uid()
     and td.expires_at > now()
     and public.is_authenticated_active()
     and public.is_aal2()
   order by coalesce(td.last_used_at, td.created_at) desc
$$;

revoke all on function public.list_my_trusted_devices() from public, anon;
grant execute on function public.list_my_trusted_devices() to authenticated;

create or replace function public.revoke_trusted_device(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_label text;
begin
  if auth.uid() is null or not public.is_authenticated_active() or not public.is_aal2() then
    raise exception 'trusted_device_aal2_required' using errcode = '42501';
  end if;

  delete from public.trusted_devices td
   where td.id = p_id
     and td.user_id = auth.uid()
  returning td.label into v_label;

  if not found then
    return false;
  end if;

  perform public.log_audit('trusted_device.revoke', 'trusted_device', p_id,
    jsonb_build_object('label', v_label));
  return true;
end;
$$;

revoke all on function public.revoke_trusted_device(uuid) from public, anon;
grant execute on function public.revoke_trusted_device(uuid) to authenticated;

-- ============================================================================
-- 3. Funkcje Edge Function device-login (service_role)
-- ============================================================================
-- Nowe wyzwanie (64 znaki hex, 60 s) dla ważnego urządzenia; null = nieznane albo wygasłe.
create or replace function public.service_trusted_device_challenge(p_device_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_challenge text;
begin
  update public.trusted_devices td
     set challenge = encode(extensions.gen_random_bytes(32), 'hex'),
         challenge_expires_at = now() + interval '60 seconds'
   where td.id = p_device_id
     and td.expires_at > now()
  returning td.challenge into v_challenge;
  return v_challenge;
end;
$$;

revoke all on function public.service_trusted_device_challenge(uuid) from public, anon, authenticated;
grant execute on function public.service_trusted_device_challenge(uuid) to service_role;

-- Zużycie wyzwania (atomowo, jednorazowo - także przy błędnym podpisie albo PIN-ie).
-- Zwraca dane do weryfikacji podpisu albo null (brak urządzenia, wygasłe, brak / przeterminowane wyzwanie).
create or replace function public.service_trusted_device_consume(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_row public.trusted_devices%rowtype;
begin
  select * into v_row
    from public.trusted_devices td
   where td.id = p_device_id
   for update;

  if not found then
    return null;
  end if;

  update public.trusted_devices td
     set challenge = null,
         challenge_expires_at = null
   where td.id = p_device_id;

  if v_row.expires_at <= now()
     or v_row.challenge is null
     or v_row.challenge_expires_at is null
     or v_row.challenge_expires_at <= now() then
    return null;
  end if;

  return jsonb_build_object(
    'user_id', v_row.user_id,
    'public_key', v_row.public_key,
    'challenge', v_row.challenge,
    'label', v_row.label
  );
end;
$$;

revoke all on function public.service_trusted_device_consume(uuid) from public, anon, authenticated;
grant execute on function public.service_trusted_device_consume(uuid) to service_role;

-- ============================================================================
-- 4. Jeden punkt odcięcia: revoke_user_access + urządzenia zaufane
-- ============================================================================
-- Treść jak w 20261113100000_security_pass4.sql + usunięcie trusted_devices.
create or replace function public.revoke_user_access(p_user_id uuid, p_reason text, p_ban boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
set row_security = off
as $$
declare
  v_sessions integer;
  v_refresh integer;
  v_mcp integer;
  v_oauth integer;
  v_codes integer;
  v_push integer;
  v_devices integer;
  v_banned boolean := false;
begin
  if p_user_id is null then
    raise exception 'p_user_id wymagane' using errcode = '22023';
  end if;

  -- Refresh tokeny najpierw (z sesja i bez), potem sesje.
  delete from auth.refresh_tokens rt where rt.user_id = p_user_id::text;
  get diagnostics v_refresh = row_count;

  delete from auth.sessions s where s.user_id = p_user_id;
  get diagnostics v_sessions = row_count;

  update public.mcp_tokens m
     set revoked_at = now()
   where m.user_id = p_user_id
     and m.revoked_at is null;
  get diagnostics v_mcp = row_count;

  update public.oauth_clients c
     set revoked_at = now()
   where c.user_id = p_user_id
     and c.revoked_at is null;
  get diagnostics v_oauth = row_count;

  delete from public.oauth_codes oc
   where oc.user_id = p_user_id
     and oc.used_at is null;
  get diagnostics v_codes = row_count;

  -- Urzadzenia push: przejeta przegladarka nie dostaje dalszych powiadomien.
  delete from public.push_subscriptions ps where ps.user_id = p_user_id;
  get diagnostics v_push = row_count;

  -- Zaufane przegladarki: bez nich logowanie z ekranu profilu wymaga znow hasla.
  delete from public.trusted_devices td where td.user_id = p_user_id;
  get diagnostics v_devices = row_count;

  if coalesce(p_ban, false) then
    update auth.users u
       set banned_until = now() + interval '100 years',
           updated_at = now()
     where u.id = p_user_id;
    v_banned := found;
  end if;

  return jsonb_build_object(
    'reason', left(p_reason, 200),
    'sessions', v_sessions,
    'refresh_tokens', v_refresh,
    'mcp_tokens', v_mcp,
    'oauth_clients', v_oauth,
    'oauth_codes', v_codes,
    'push_subscriptions', v_push,
    'trusted_devices', v_devices,
    'banned', v_banned
  );
end;
$$;

revoke all on function public.revoke_user_access(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.revoke_user_access(uuid, text, boolean) to service_role;

-- ============================================================================
-- 5. Retencja
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('trusted-devices-retention', '50 3 * * *',
      $job$delete from public.trusted_devices where expires_at < now()$job$);
  end if;
end $$;

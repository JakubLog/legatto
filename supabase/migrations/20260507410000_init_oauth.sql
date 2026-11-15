-- ePosel — OAuth 2.0 Authorization Server
--
-- Pozwala claude.ai (web) podlaczyc sie do MCP servera przez standard OAuth 2.0
-- Authorization Code + PKCE flow, bez wklejania tokenow recznie.
--
-- Flow:
--   1. Posel generuje OAuth App (client_id + client_secret) w /biuro/admin/integracje.
--   2. Wkleja je w claude.ai przy dodawaniu Remote MCP server.
--   3. claude.ai robi Authorization Code + PKCE redirect na /api/oauth/authorize.
--   4. Posel loguje sie (Supabase credentials) na stronie autoryzacji.
--   5. Nasz server generuje code, redirect z powrotem do claude.ai.
--   6. claude.ai wymienia code na access_token przez /api/oauth/token.
--   7. Dalej dziala tak samo jak mcp_tokens (Bearer epm_xxx).
--
-- Tabele: oauth_clients, oauth_codes
-- Nowa kolumna na mcp_tokens: oauth_client_id (nullable FK)
-- RPC: create_oauth_client, revoke_oauth_client, mcp_consume_token bez zmian

-- ============================================================================
-- 1. Tabela oauth_clients
-- ============================================================================
create table if not exists public.oauth_clients (
  client_id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  client_secret_hash text not null,
  client_secret_prefix text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table public.oauth_clients is
  'OAuth 2.0 clients dla claude.ai integracji. Generowane przez Posla w admin panelu.';

create index if not exists oauth_clients_user_id_idx on public.oauth_clients(user_id);

alter table public.oauth_clients enable row level security;

-- SELECT: tylko wlasciciel + aal2
create policy oauth_clients_select_self on public.oauth_clients
  for select to authenticated
  using (user_id = auth.uid() and public.is_aal2());

-- INSERT/UPDATE/DELETE przez RPC SECURITY DEFINER

-- ============================================================================
-- 2. Tabela oauth_codes (jednorazowe kody autoryzacyjne, TTL 10 min)
-- ============================================================================
create table if not exists public.oauth_codes (
  code text primary key,
  client_id text not null references public.oauth_clients(client_id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  scope text not null default 'mcp',
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz
);

comment on table public.oauth_codes is
  'Jednorazowe kody OAuth (TTL 10 min). Uzywane tylko przez service_role w Vercel.';

alter table public.oauth_codes enable row level security;
-- Brak policy dla authenticated/anon: tylko service_role (bypasses RLS)

-- ============================================================================
-- 3. Kolumna oauth_client_id na mcp_tokens (zrodlo tokenu)
-- ============================================================================
alter table public.mcp_tokens
  add column if not exists oauth_client_id text
  references public.oauth_clients(client_id) on delete set null;

-- ============================================================================
-- 4. RPC: create_oauth_client (Posel-only + aal2)
-- ============================================================================
create or replace function public.create_oauth_client(p_name text)
returns table (client_id text, client_secret text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role;
  v_client_id text;
  v_secret text;
  v_secret_hash text;
  v_secret_prefix text;
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_user_id and is_active = true;
  if v_role is distinct from 'posel'::public.app_role then
    raise exception 'Brak uprawnien (wymagana rola: posel)' using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Nazwa aplikacji jest wymagana' using errcode = '22023';
  end if;

  -- client_id: epc_ + 16 znakow base64url
  v_client_id := 'epc_' || translate(
    rtrim(encode(extensions.gen_random_bytes(12), 'base64'), '='), '+/', '-_'
  );

  -- client_secret: eps_ + 48 znakow base64url
  v_secret := 'eps_' || translate(
    rtrim(encode(extensions.gen_random_bytes(36), 'base64'), '='), '+/', '-_'
  );
  v_secret_hash := encode(extensions.digest(v_secret, 'sha256'), 'hex');
  v_secret_prefix := substr(v_secret, 5, 8);

  insert into public.oauth_clients(client_id, user_id, name, client_secret_hash, client_secret_prefix)
  values (v_client_id, v_user_id, trim(p_name), v_secret_hash, v_secret_prefix);

  perform public.log_audit(
    'oauth_client.create', 'oauth_client', null,
    jsonb_build_object('name', trim(p_name), 'client_id', v_client_id)
  );

  return query select v_client_id, v_secret;
end;
$$;

revoke all on function public.create_oauth_client(text) from public, anon;
grant execute on function public.create_oauth_client(text) to authenticated;

-- ============================================================================
-- 5. RPC: revoke_oauth_client (wlasciciel + aal2)
-- ============================================================================
create or replace function public.revoke_oauth_client(p_client_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_client record;
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  select client_id, name, revoked_at
    into v_client
    from public.oauth_clients
   where client_id = p_client_id and user_id = v_user_id;

  if not found then
    raise exception 'OAuth App nie istnieje lub nie nalezy do uzytkownika'
      using errcode = '22023';
  end if;
  if v_client.revoked_at is not null then return; end if;

  update public.oauth_clients set revoked_at = now() where client_id = p_client_id;

  perform public.log_audit(
    'oauth_client.revoke', 'oauth_client', null,
    jsonb_build_object('client_id', p_client_id, 'name', v_client.name)
  );
end;
$$;

revoke all on function public.revoke_oauth_client(text) from public, anon;
grant execute on function public.revoke_oauth_client(text) to authenticated;

-- ============================================================================
-- 6. RPC: oauth_verify_client (service_role only)
--    Sprawdza client_id + client_secret, zwraca user_id lub NULL
-- ============================================================================
create or replace function public.oauth_verify_client(
  p_client_id text,
  p_client_secret text
)
returns table (user_id uuid, client_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  v_hash := encode(extensions.digest(p_client_secret, 'sha256'), 'hex');

  return query
  select c.user_id, c.name
  from public.oauth_clients c
  where c.client_id = p_client_id
    and c.client_secret_hash = v_hash
    and c.revoked_at is null;
end;
$$;

revoke all on function public.oauth_verify_client(text, text) from public, anon, authenticated;
grant execute on function public.oauth_verify_client(text, text) to service_role;

-- ============================================================================
-- 7. Cleanup: usuwaj przeterminowane kody (nie ma scheduled jobs, ale przy
--    kazdym uzyciu service_role czyści stare kody starsze niz 1h)
-- ============================================================================
create or replace function public.oauth_cleanup_codes()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.oauth_codes
  where expires_at < now() - interval '1 hour';
end;
$$;

revoke all on function public.oauth_cleanup_codes() from public, anon, authenticated;
grant execute on function public.oauth_cleanup_codes() to service_role;

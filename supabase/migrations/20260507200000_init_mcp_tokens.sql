-- ePosel - MCP integration tokens
--
-- Tabela mcp_tokens przechowuje long-lived API tokeny do podlaczenia ePosel
-- jako MCP server (Model Context Protocol) - Posel generuje token w UI
-- (/biuro/admin/integracje), wkleja do konfiguracji Claude (Desktop / claude.ai),
-- a Claude wola endpoint /api/mcp na Vercel z Bearer <token>.
--
-- Format tokena: epm_<48 znakow base64url>. W DB tylko sha256 hash (hex) +
-- prefix do listingu (12 pierwszych znakow plain). Plain widoczny jeden raz
-- w dialogu po utworzeniu, potem nigdy.
--
-- RPC:
--   create_mcp_token(name)        - Posel-only + aal2; returns plaintext token
--   revoke_mcp_token(token_id)    - wlasciciel; soft-delete (revoked_at)
--   mcp_consume_token(token_hash) - service_role only; lookup + bump last_used_at
--
-- pgcrypto siedzi w schemie `extensions` (Supabase default) - kwalifikujemy
-- wszystkie wywolania jako extensions.digest / extensions.gen_random_bytes.

-- ============================================================================
-- 1. Tabela mcp_tokens
-- ============================================================================
create table if not exists public.mcp_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  token_hash text not null unique,
  token_prefix text not null,
  scopes text[] not null default array['cases','contacts','events','interpellations'],
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists mcp_tokens_user_id_idx on public.mcp_tokens(user_id);
create index if not exists mcp_tokens_active_hash_idx
  on public.mcp_tokens(token_hash) where revoked_at is null;

comment on table public.mcp_tokens is
  'Long-lived API tokeny dla MCP integracji. Hash sha256 - plaintext widoczny tylko raz.';
comment on column public.mcp_tokens.token_hash is 'sha256 hex calego plaintexta epm_xxx';
comment on column public.mcp_tokens.token_prefix is
  '12 znakow z plaintextu (po prefiksie epm_) do identyfikacji w UI - reszta nieodtwarzalna';

alter table public.mcp_tokens enable row level security;

-- ============================================================================
-- 2. RLS - SELECT wlasne; CUD blokowane (RPC SECURITY DEFINER)
-- ============================================================================
drop policy if exists mcp_tokens_select_self on public.mcp_tokens;
create policy mcp_tokens_select_self on public.mcp_tokens
  for select to authenticated
  using (user_id = auth.uid() and public.is_aal2());

-- Brak INSERT/UPDATE/DELETE policy = wszystko forbidden dla authenticated
-- (operacje przez RPC SECURITY DEFINER, ktore nie szanuja policy)

-- ============================================================================
-- 3. RPC: create_mcp_token (Posel-only + aal2)
-- ============================================================================
create or replace function public.create_mcp_token(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role;
  v_token text;
  v_random text;
  v_hash text;
  v_prefix text;
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  -- aal2 wymagane (zgodnie z reszta wrazliwych operacji)
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  -- Tylko Posel moze tworzyc tokeny MCP w v1
  select role into v_role from public.profiles where id = v_user_id and is_active = true;
  if v_role is distinct from 'posel'::public.app_role then
    raise exception 'Brak uprawnien (wymagana rola: posel)' using errcode = '42501';
  end if;

  -- Walidacja nazwy
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Nazwa tokena jest wymagana' using errcode = '22023';
  end if;
  if length(p_name) > 60 then
    raise exception 'Nazwa tokena nie moze przekraczac 60 znakow' using errcode = '22023';
  end if;

  -- 36 bajtow losowych -> base64 -> base64url (- zamiast + i / zamiast _, bez =)
  -- Daje 48 znakow ASCII bezpiecznych w URL/JSON.
  v_random := translate(
    rtrim(encode(extensions.gen_random_bytes(36), 'base64'), '='),
    '+/',
    '-_'
  );
  v_token := 'epm_' || v_random;
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_prefix := substr(v_random, 1, 12);

  insert into public.mcp_tokens(user_id, name, token_hash, token_prefix)
  values (v_user_id, trim(p_name), v_hash, v_prefix);

  perform public.log_audit(
    'mcp_token.create',
    'mcp_token',
    null,
    jsonb_build_object('name', trim(p_name), 'prefix', v_prefix)
  );

  return v_token;
end;
$$;

revoke all on function public.create_mcp_token(text) from public, anon;
grant execute on function public.create_mcp_token(text) to authenticated;

-- ============================================================================
-- 4. RPC: revoke_mcp_token (wlasciciel + aal2)
-- ============================================================================
create or replace function public.revoke_mcp_token(p_token_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_token record;
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  select id, name, token_prefix, revoked_at
    into v_token
    from public.mcp_tokens
   where id = p_token_id and user_id = v_user_id;

  if not found then
    raise exception 'Token nie istnieje lub nie nalezy do uzytkownika'
      using errcode = '22023';
  end if;

  if v_token.revoked_at is not null then
    return; -- juz odwolany - idempotent
  end if;

  update public.mcp_tokens
     set revoked_at = now()
   where id = p_token_id;

  perform public.log_audit(
    'mcp_token.revoke',
    'mcp_token',
    p_token_id::text,
    jsonb_build_object('name', v_token.name, 'prefix', v_token.token_prefix)
  );
end;
$$;

revoke all on function public.revoke_mcp_token(uuid) from public, anon;
grant execute on function public.revoke_mcp_token(uuid) to authenticated;

-- ============================================================================
-- 5. RPC: mcp_consume_token (service_role only)
-- ============================================================================
-- Wywolywana z Vercel serverless funkcji (api/mcp.ts) z service_role JWT.
-- Sprawdza ze token jest aktywny, zwraca user_id + scopes, bumpuje last_used_at.
-- Dla authenticated/anon REVOKE - klient frontendowy nie moze tej funkcji uzyc.
create or replace function public.mcp_consume_token(p_token_hash text)
returns table (
  token_id uuid,
  user_id uuid,
  scopes text[],
  user_role public.app_role,
  user_full_name text,
  user_is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with t as (
    update public.mcp_tokens m
       set last_used_at = now()
     where m.token_hash = p_token_hash
       and m.revoked_at is null
    returning m.id, m.user_id, m.scopes
  )
  select
    t.id,
    t.user_id,
    t.scopes,
    p.role,
    p.full_name,
    p.is_active
  from t
  join public.profiles p on p.id = t.user_id;
end;
$$;

revoke all on function public.mcp_consume_token(text) from public, anon, authenticated;
grant execute on function public.mcp_consume_token(text) to service_role;

-- ============================================================================
-- 6. RPC: mcp_log_audit (service_role only)
-- ============================================================================
-- Dedykowany helper dla MCP serverless (api/mcp.ts) - log_audit oryginalnie
-- czerpie user_id z auth.uid(), ktore z service_role JWT jest NULL. Tu
-- przyjmujemy user_id explicit i wstawiamy do audit_log z bypassem RLS.
create or replace function public.mcp_log_audit(
  p_user_id uuid,
  p_action text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_email text;
begin
  if p_user_id is null then
    raise exception 'p_user_id wymagane' using errcode = '22023';
  end if;
  if p_action is null or length(p_action) = 0 then
    raise exception 'p_action wymagane' using errcode = '22023';
  end if;

  select email into v_email from public.profiles where id = p_user_id;

  insert into public.audit_log (user_id, user_email, action, entity_type, entity_id, metadata)
  values (
    p_user_id,
    v_email,
    p_action,
    p_entity_type,
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('via_mcp', true)
  );
end;
$$;

revoke all on function public.mcp_log_audit(uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_log_audit(uuid, text, text, uuid, jsonb) to service_role;

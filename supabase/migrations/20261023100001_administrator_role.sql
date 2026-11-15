-- ============================================================================
-- Rola Administrator (2/2): te same uprawnienia co Posel
-- ============================================================================
-- Wszystkie polityki RLS i edge functions admin-* sprawdzaja uprawnienia Posla
-- przez is_posel() - funkcja zachowuje nazwe, ale oznacza teraz "uprawnienia
-- Posla" (rola posel LUB administrator). Ponizej odtwarzamy tez funkcje, ktore
-- porownywaly role = 'posel' bezposrednio zamiast wolac is_posel().

create or replace function public.is_posel()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('posel', 'administrator') and is_active = true
  )
$$;

create or replace function public.is_writer()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('posel', 'administrator', 'pracownik') and is_active = true
  )
$$;

create or replace function public.get_all_users_admin()
returns table (
  id uuid,
  email text,
  full_name text,
  role public.app_role,
  is_active boolean,
  office_id uuid,
  phone text,
  avatar_url text,
  is_public boolean,
  password_set boolean,
  scope_contacts public.data_scope,
  scope_cases public.data_scope,
  scope_events public.data_scope,
  scope_interpellations public.data_scope,
  created_at timestamptz,
  updated_at timestamptz,
  office_name text,
  office_city text,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
#variable_conflict use_column
begin
  if not public.is_posel() then
    raise exception 'Brak uprawnien (wymagana rola: posel lub administrator)' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagane uwierzytelnienie dwuskladnikowe (aal2)' using errcode = '42501';
  end if;

  return query
    select
      p.id, p.email, p.full_name, p.role, p.is_active, p.office_id,
      p.phone, p.avatar_url, p.is_public, p.password_set,
      p.scope_contacts, p.scope_cases, p.scope_events, p.scope_interpellations,
      p.created_at, p.updated_at,
      o.name, o.city,
      au.last_sign_in_at
    from public.profiles p
    left join public.offices o on o.id = p.office_id
    left join auth.users au on au.id = p.id
    order by p.created_at desc;
end;
$$;

create or replace function public.get_user_admin_details(p_user_id uuid)
returns table (
  user_id uuid,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  auth_created_at timestamptz,
  sessions_count integer,
  mfa_factors_total integer,
  mfa_factors_verified integer
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  if not public.is_posel() then
    raise exception 'Brak uprawnien (wymagana rola: posel lub administrator)' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagane uwierzytelnienie dwuskladnikowe (aal2)' using errcode = '42501';
  end if;

  return query
    select
      u.id as user_id,
      u.last_sign_in_at,
      u.email_confirmed_at,
      u.created_at as auth_created_at,
      coalesce((
        select count(*)::int
        from auth.sessions s
        where s.user_id = p_user_id
          and (s.not_after is null or s.not_after > now())
      ), 0) as sessions_count,
      coalesce((
        select count(*)::int
        from auth.mfa_factors f
        where f.user_id = p_user_id
      ), 0) as mfa_factors_total,
      coalesce((
        select count(*)::int
        from auth.mfa_factors f
        where f.user_id = p_user_id and f.status = 'verified'
      ), 0) as mfa_factors_verified
    from auth.users u
    where u.id = p_user_id;
end;
$$;

create or replace function public.get_office_colleagues(p_office_id uuid)
returns table (
  id uuid,
  full_name text,
  role public.app_role,
  phone text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
#variable_conflict use_column
declare
  v_caller_office_id uuid;
  v_is_posel boolean;
begin
  select me.office_id, me.role in ('posel', 'administrator')
  into v_caller_office_id, v_is_posel
  from public.profiles me
  where me.id = auth.uid() and me.is_active = true;

  if not found
     or not public.is_aal2()
     or (not coalesce(v_is_posel, false) and v_caller_office_id is distinct from p_office_id) then
    raise exception 'Brak uprawnien' using errcode = '42501';
  end if;

  return query
    select p.id, p.full_name, p.role, p.phone, p.avatar_url
    from public.profiles p
    where p.office_id = p_office_id and p.is_active = true
    order by
      case p.role when 'posel' then 1 when 'administrator' then 2 when 'pracownik' then 3 else 4 end,
      p.full_name;
end;
$$;

create or replace function public.get_public_office_staff(p_office_id uuid)
returns table (
  id uuid,
  full_name text,
  role public.app_role,
  phone text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.role, p.phone, p.avatar_url
  from public.profiles p
  inner join public.offices o on o.id = p.office_id
  where p.office_id = p_office_id
    and p.is_active = true
    and p.is_public = true
    and o.is_active = true
  order by
    case p.role when 'posel' then 1 when 'administrator' then 2 when 'pracownik' then 3 else 4 end,
    p.full_name;
$$;

-- Zakresy tokena MCP: Administrator = Posel. To samo mapowanie w api/oauth/token.ts.
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
  v_scopes text[];
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_user_id and is_active = true;

  if v_role in ('posel'::public.app_role, 'administrator'::public.app_role) then
    v_scopes := array['cases','contacts','events','interpellations','budget','audit'];
  elsif v_role = 'pracownik'::public.app_role then
    v_scopes := array['cases','contacts','events','interpellations_read','budget_read'];
  else
    raise exception 'Brak uprawnien (wymagana rola: posel, administrator lub pracownik)' using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Nazwa tokena jest wymagana' using errcode = '22023';
  end if;
  if length(p_name) > 60 then
    raise exception 'Nazwa tokena nie moze przekraczac 60 znakow' using errcode = '22023';
  end if;

  v_random := translate(
    rtrim(encode(extensions.gen_random_bytes(36), 'base64'), '='),
    '+/', '-_'
  );
  v_token := 'epm_' || v_random;
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_prefix := substr(v_random, 1, 12);

  insert into public.mcp_tokens(user_id, name, token_hash, token_prefix, scopes)
  values (v_user_id, trim(p_name), v_hash, v_prefix, v_scopes);

  perform public.log_audit(
    'mcp_token.create', 'mcp_token', null,
    jsonb_build_object('name', trim(p_name), 'prefix', v_prefix, 'role', v_role)
  );

  return v_token;
end;
$$;

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
  if v_role is null
     or v_role not in (
       'posel'::public.app_role, 'administrator'::public.app_role, 'pracownik'::public.app_role
     ) then
    raise exception 'Brak uprawnien (wymagana rola: posel, administrator lub pracownik)' using errcode = '42501';
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

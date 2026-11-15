-- Fix: revoke_mcp_token przekazywalo p_token_id::text do log_audit,
-- ktore oczekuje uuid jako trzeci argument → "function does not exist".
-- Poprawka: p_token_id (uuid) bezposrednio.

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
    return;
  end if;

  update public.mcp_tokens
     set revoked_at = now()
   where id = p_token_id;

  perform public.log_audit(
    'mcp_token.revoke',
    'mcp_token',
    p_token_id,   -- uuid, nie text
    jsonb_build_object('name', v_token.name, 'prefix', v_token.token_prefix)
  );
end;
$$;

revoke all on function public.revoke_mcp_token(uuid) from public, anon;
grant execute on function public.revoke_mcp_token(uuid) to authenticated;

-- ePosel - usuwanie unieważnionych tokenów MCP
--
-- RPC delete_mcp_token(token_id) - hard delete unieważnionego tokena.
-- Wymagania:
--   - aal2 (jak reszta wrażliwych operacji)
--   - właściciel tokena
--   - token MUSI być wcześniej unieważniony (revoked_at is not null)
--     -> aktywne tokeny chronimy przed przypadkowym wyczyszczeniem; aby skasować
--        aktywny, najpierw revoke, potem delete (dwa kliknięcia w UI).
--
-- Audit zapisujemy z entity_id = null (rekord zaraz znika; identyfikator
-- przekazujemy w metadanych, żeby ślad pozostał).

create or replace function public.delete_mcp_token(p_token_id uuid)
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

  if v_token.revoked_at is null then
    raise exception 'Token jest aktywny - najpierw uniewaznij, potem usun'
      using errcode = '22023';
  end if;

  delete from public.mcp_tokens where id = p_token_id;

  perform public.log_audit(
    'mcp_token.delete',
    'mcp_token',
    null,
    jsonb_build_object(
      'token_id', p_token_id,
      'name', v_token.name,
      'prefix', v_token.token_prefix
    )
  );
end;
$$;

revoke all on function public.delete_mcp_token(uuid) from public, anon;
grant execute on function public.delete_mcp_token(uuid) to authenticated;

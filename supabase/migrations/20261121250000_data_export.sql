-- compat-n-1: safe
-- Legatto (A13, U4): ręczny eksport danych biura dla posła.
--
-- Jedynym backupem VPS jest backup Hetzner (obraz dysku), więc poseł może w każdej chwili
-- zabrać pełną kopię danych biura: Edge Function admin-export-data składa archiwum ZIP
-- (AES-256, hasło podaje poseł) z tabel i plików. Dostęp:
--   - tylko powierzchnia admin (require_admin_surface; na crm proxy dodatkowo blokuje admin-*),
--   - Poseł/Administrator z aal2 (is_posel() and is_aal2()),
--   - każdy eksport w audit_log (data.export_started / data.export_finished, bez treści).
-- Tabele z sekretami (hashe tokenów MCP/OAuth, PIN, subskrypcje push, zaufane urządzenia,
-- konfiguracja dispatchera) nie wchodzą do eksportu; z app_settings pomijane są klucze sekretne.

create or replace function public.export_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'offices', 'profiles', 'powiaty', 'gminy', 'case_categories', 'expense_categories',
    'contacts', 'cases', 'case_activity', 'case_comments', 'case_attachments',
    'events', 'interpellations', 'interpellation_duration_samples',
    'office_expenses', 'budget_reports', 'module_owners',
    'newsletter_issues', 'posts',
    'signing_batches', 'signing_batch_items', 'signing_documents', 'signing_document_files',
    'poliai_conversations', 'poliai_attachments',
    'trash_items', 'trash_entities', 'ics_sources', 'app_settings', 'audit_log'
  ]::text[]
$$;

comment on function public.export_tables() is
  'Lista tabel eksportu danych dla posła (A13). Tabele z sekretami celowo poza listą.';

create or replace function public.export_assert_allowed()
returns void
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  perform public.require_admin_surface();
  if not (public.is_posel() and public.is_aal2()) then
    raise exception 'Eksport danych: wymagany Poseł/Administrator z 2FA' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.export_tables() from public, anon;
revoke all on function public.export_assert_allowed() from public, anon;
grant execute on function public.export_tables() to authenticated, service_role;
grant execute on function public.export_assert_allowed() to authenticated;

-- Strona wierszy jednej tabeli (porządek po kluczu głównym). Kolumny z sekretami są usuwane.
create or replace function public.export_office_data(p_table text, p_offset bigint, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_order text;
  v_rows jsonb;
begin
  perform public.export_assert_allowed();
  if p_table is null or not (p_table = any (public.export_tables())) then
    raise exception 'Tabela spoza eksportu' using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit < 1 or p_limit > 2000 then
    raise exception 'p_offset >= 0, p_limit 1..2000' using errcode = '22023';
  end if;

  select string_agg(format('%I', a.attname), ', ' order by array_position(i.indkey::int2[], a.attnum))
    into v_order
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = format('public.%I', p_table)::regclass and i.indisprimary;
  if v_order is null then
    v_order := 'ctid';
  end if;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I order by %s offset $1 limit $2) t',
    p_table, v_order)
    into v_rows
    using p_offset, p_limit;

  if p_table = 'app_settings' then
    select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
      from jsonb_array_elements(v_rows) r
     where not (r ->> 'key' ~ '(api_key|secret|token|password|private)');
  elsif p_table = 'ics_sources' then
    -- Adres ICS bywa sekretem (token w URL) - eksport tylko nazwy i stanu.
    select coalesce(jsonb_agg(r - 'url'), '[]'::jsonb) into v_rows from jsonb_array_elements(v_rows) r;
  end if;
  return v_rows;
end;
$$;

-- Pliki do eksportu: obiekty prywatnych i publicznych bucketów biura.
create or replace function public.export_office_files()
returns table (bucket_id text, name text, size bigint)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  perform public.export_assert_allowed();
  return query
    select o.bucket_id::text, o.name::text, coalesce((o.metadata ->> 'size')::bigint, 0)
      from storage.objects o
     where o.bucket_id in ('case-attachments', 'receipts', 'signing-documents', 'poliai-attachments',
                           'newsletter-assets', 'site-assets', 'avatars')
       and o.name is not null
     order by o.bucket_id, o.name;
end;
$$;

-- Audyt eksportu (wołany przez funkcję Edge tokenem użytkownika, więc auth.uid() = poseł).
create or replace function public.export_log(p_phase text, p_metadata jsonb)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  perform public.export_assert_allowed();
  if p_phase not in ('started', 'finished', 'failed') then
    raise exception 'p_phase: started|finished|failed' using errcode = '22023';
  end if;
  perform public.log_audit('data.export_' || p_phase, 'data_export', null,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('surface', public.request_surface()));
end;
$$;

revoke all on function public.export_office_data(text, bigint, integer) from public, anon;
revoke all on function public.export_office_files() from public, anon;
revoke all on function public.export_log(text, jsonb) from public, anon;
grant execute on function public.export_office_data(text, bigint, integer) to authenticated;
grant execute on function public.export_office_files() to authenticated;
grant execute on function public.export_log(text, jsonb) to authenticated;

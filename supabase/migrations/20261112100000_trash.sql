-- Kosz (2026-11-12): usunięte sprawy (z załącznikami, komentarzami i historią), kontakty,
-- interpelacje, wydatki (z paragonami), raporty budżetowe i dokumenty do podpisu (z plikami)
-- trafiają na 7 dni do kosza z możliwością przywrócenia, potem znikają trwale razem z plikami.
--
-- Model: wiersz NAPRAWDĘ znika z tabeli (wszystkie odczyty - lista, RLS, RPC, MCP, PoliAI, puls -
-- działają bez zmian), a wyzwalacz BEFORE DELETE zapisuje jego migawkę do `trash_items`.
-- Dzieci usuwane kaskadą (np. załączniki sprawy) trafiają do tej samej grupy co rodzic,
-- odpięcia FK `on delete set null` (np. wydarzenie powiązane ze sprawą) zapisują się jako
-- `relinks` i wracają przy przywróceniu. Pliki w storage zostają, dopóki pozycja jest w koszu
-- (zapytania o osierocone pliki pomijają ścieżki z kosza); po usunięciu pozycji z kosza
-- (ręcznie albo po 7 dniach) nocny cron `poliai-purge` usuwa pliki jak każde inne sieroty.
--
-- Przywracanie (`trash_restore`) wstawia wiersze z migawki z ustawionym GUC
-- `eposel.trash_restoring`; wszystkie wyzwalacze użytkownika na tabelach kosza i tabelach
-- z odpięciami mają warunek `when (not public.trash_restoring())`, więc przywrócenie nie
-- nadpisuje autora (`set_created_by`), nie dubluje audytu „create”, historii ani powiadomień.
-- UWAGA dla kolejnych migracji: wyzwalacz tworzony od nowa na tych tabelach dostaje warunek
-- przez `select public.trash_guard_triggers();` na końcu migracji.

-- ============================================================================
-- 1. Konfiguracja tabel kosza
-- ============================================================================

create table public.trash_entities (
  table_name text primary key,
  entity text not null unique,
  -- Kolejność wstawiania przy przywróceniu (rodzic przed dziećmi).
  restore_order smallint not null default 0,
  -- Dziecko kaskadowe: tabela rodzica i kolumna FK. Usunięte razem z rodzicem dołącza do jego grupy.
  parent_table text references public.trash_entities(table_name),
  parent_column text,
  -- Czy wiersz usunięty samodzielnie (bez rodzica w tej samej transakcji) trafia do kosza.
  -- false: tylko razem z rodzicem (np. historia sprawy, wersje plików dokumentu).
  can_be_root boolean not null,
  storage_bucket text,
  storage_column text,
  check ((parent_table is null) = (parent_column is null)),
  check ((storage_bucket is null) = (storage_column is null))
);

insert into public.trash_entities
  (table_name, entity, restore_order, parent_table, parent_column, can_be_root, storage_bucket, storage_column)
values
  ('cases', 'case', 0, null, null, true, null, null),
  ('contacts', 'contact', 0, null, null, true, null, null),
  ('interpellations', 'interpellation', 0, null, null, true, null, null),
  ('office_expenses', 'expense', 0, null, null, true, 'receipts', 'receipt_path'),
  ('budget_reports', 'budget_report', 0, null, null, true, null, null),
  ('signing_documents', 'signing_document', 0, null, null, true, null, null);

insert into public.trash_entities
  (table_name, entity, restore_order, parent_table, parent_column, can_be_root, storage_bucket, storage_column)
values
  ('case_attachments', 'case_attachment', 1, 'cases', 'case_id', true, 'case-attachments', 'storage_path'),
  ('case_comments', 'case_comment', 1, 'cases', 'case_id', true, null, null),
  ('case_activity', 'case_activity', 1, 'cases', 'case_id', false, null, null),
  ('interpellation_duration_samples', 'interpellation_sample', 1, 'interpellations', 'interpellation_id', false, null, null),
  ('signing_document_files', 'signing_document_file', 1, 'signing_documents', 'document_id', false, 'signing-documents', 'storage_path'),
  ('signing_batch_items', 'signing_batch_item', 2, 'signing_documents', 'document_id', false, null, null);

alter table public.trash_entities enable row level security;
revoke all on table public.trash_entities from public, anon, authenticated;
grant all on table public.trash_entities to service_role;

-- ============================================================================
-- 2. Pozycje kosza
-- ============================================================================

create table public.trash_items (
  id bigint generated always as identity primary key,
  -- Jedno usunięcie = jedna grupa (rodzic + dzieci z kaskady); przywraca się i usuwa całą grupę.
  group_id uuid not null,
  table_name text not null references public.trash_entities(table_name),
  entity text not null,
  -- Pozycja widoczna w koszu (usunięta bezpośrednio); dzieci z kaskady mają false.
  is_root boolean not null,
  row_key jsonb not null,
  row_data jsonb not null,
  -- Odpięcia `on delete set null`: [{table, column, value, keys: [klucze wierszy]}].
  relinks jsonb not null default '[]'::jsonb,
  -- Pliki chronione przed sprzątaniem sierot: 'bucket/ścieżka'.
  storage_objects text[] not null default '{}',
  title text,
  context text,
  deleted_by uuid references public.profiles(id) on delete set null,
  deleted_at timestamptz not null default now(),
  purge_after timestamptz not null default now() + interval '7 days',
  tx_id bigint not null default txid_current()
);

create index trash_items_group_idx on public.trash_items (group_id);
create index trash_items_tx_idx on public.trash_items (tx_id, table_name);
create index trash_items_root_idx on public.trash_items (deleted_at desc) where is_root;
create index trash_items_purge_idx on public.trash_items (purge_after);
create index trash_items_storage_idx on public.trash_items using gin (storage_objects);

alter table public.trash_items enable row level security;
-- Bez polityk: odczyt i zmiany wyłącznie przez RPC poniżej (SECURITY DEFINER).
revoke all on table public.trash_items from public, anon, authenticated;
grant all on table public.trash_items to service_role;

-- ============================================================================
-- 3. Strażnik wyzwalaczy podczas przywracania
-- ============================================================================

create or replace function public.trash_restoring()
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(current_setting('eposel.trash_restoring', true), '') = 'on'
$$;

grant execute on function public.trash_restoring() to public;

-- Dopisuje `when (not public.trash_restoring())` do wyzwalaczy użytkownika na tabelach kosza
-- i na tabelach odpinanych przez `on delete set null` (poza samym wyzwalaczem kosza).
-- Idempotentne - kolejne migracje wywołują po utworzeniu nowych wyzwalaczy na tych tabelach.
create or replace function public.trash_guard_triggers()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  r record;
  v_def text;
  v_count integer := 0;
begin
  for r in
    select t.oid, t.tgname, t.tgrelid::regclass as rel, pg_get_triggerdef(t.oid) as def
      from pg_trigger t
     where not t.tgisinternal
       and t.tgname <> 'trash_capture'
       and t.tgrelid in (
         select ('public.' || quote_ident(e.table_name))::regclass from public.trash_entities e
         union
         select c.conrelid
           from pg_constraint c
          where c.contype = 'f' and c.confdeltype = 'n'
            and c.confrelid in (select ('public.' || quote_ident(e.table_name))::regclass from public.trash_entities e)
       )
       and pg_get_triggerdef(t.oid) not like '%trash_restoring()%'
  loop
    if r.def ~ ' WHEN \(' then
      v_def := regexp_replace(r.def, ' WHEN \((.*)\) EXECUTE FUNCTION ',
        ' WHEN ((NOT public.trash_restoring()) AND (\1)) EXECUTE FUNCTION ');
    else
      v_def := replace(r.def, ' EXECUTE FUNCTION ', ' WHEN (NOT public.trash_restoring()) EXECUTE FUNCTION ');
    end if;
    execute format('drop trigger %I on %s', r.tgname, r.rel);
    execute v_def;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.trash_guard_triggers() from public, anon, authenticated;

-- ============================================================================
-- 4. Zapis do kosza (BEFORE DELETE)
-- ============================================================================

-- Klucz główny wiersza jako wyrażenie SQL budujące jsonb (np. jsonb_build_object('id', id)).
create or replace function public.trash_pk_expr(p_rel regclass, p_alias text default null)
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'jsonb_build_object(' || string_agg(
           quote_literal(a.attname) || ', ' || coalesce(quote_ident(p_alias) || '.', '') || quote_ident(a.attname),
           ', ' order by a.attnum) || ')'
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = p_rel and i.indisprimary
$$;

revoke all on function public.trash_pk_expr(regclass, text) from public, anon, authenticated;

create or replace function public.trash_capture()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_cfg public.trash_entities%rowtype;
  v_row jsonb := to_jsonb(old);
  v_group uuid;
  v_root boolean := true;
  v_key jsonb;
  v_relinks jsonb := '[]'::jsonb;
  v_keys jsonb;
  v_pk text;
  v_storage text[] := '{}';
  v_title text;
  v_context text;
  r record;
begin
  -- Sprzątanie systemowe (np. pliki anulowanych dokumentów po 30 dniach) omija kosz.
  if coalesce(current_setting('eposel.trash_skip', true), '') = 'on' then
    return old;
  end if;

  select * into v_cfg from public.trash_entities where table_name = tg_table_name;
  if not found then
    return old;
  end if;

  if v_cfg.parent_table is not null then
    select t.group_id into v_group
      from public.trash_items t
     where t.tx_id = txid_current()
       and t.table_name = v_cfg.parent_table
       and t.row_key ->> 'id' = v_row ->> v_cfg.parent_column
     limit 1;
    v_root := v_group is null;
  end if;

  if v_group is null then
    if not v_cfg.can_be_root then
      return old;
    end if;
    v_group := gen_random_uuid();
  end if;

  select jsonb_object_agg(a.attname, v_row -> a.attname) into v_key
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = tg_relid and i.indisprimary;

  -- Wiersze, którym usunięcie wyzeruje FK (`on delete set null`) - do ponownego podpięcia.
  for r in
    select c.conrelid::regclass as ref_rel, ra.attname as ref_col, pa.attname as parent_col
      from pg_constraint c
      join pg_attribute ra on ra.attrelid = c.conrelid and ra.attnum = c.conkey[1]
      join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
     where c.contype = 'f' and c.confrelid = tg_relid and c.confdeltype = 'n'
       and array_length(c.conkey, 1) = 1
  loop
    v_pk := public.trash_pk_expr(r.ref_rel, 'x');
    continue when v_pk is null or v_row ->> r.parent_col is null;
    execute format('select coalesce(jsonb_agg(%s), ''[]''::jsonb) from %s x where x.%I::text = $1',
      v_pk, r.ref_rel, r.ref_col)
      into v_keys using v_row ->> r.parent_col;
    if jsonb_array_length(v_keys) > 0 then
      v_relinks := v_relinks || jsonb_build_array(jsonb_build_object(
        'table', r.ref_rel::text, 'column', r.ref_col, 'value', v_row ->> r.parent_col, 'keys', v_keys));
    end if;
  end loop;

  if v_cfg.storage_column is not null and nullif(v_row ->> v_cfg.storage_column, '') is not null then
    v_storage := array[v_cfg.storage_bucket || '/' || (v_row ->> v_cfg.storage_column)];
  end if;

  if v_root then
    case tg_table_name
      when 'cases' then v_title := v_row ->> 'title';
      when 'contacts' then v_title := trim(concat_ws(' ', v_row ->> 'first_name', v_row ->> 'last_name'));
      when 'interpellations' then
        v_title := v_row ->> 'subject';
        v_context := v_row ->> 'recipient';
      when 'office_expenses' then
        v_title := v_row ->> 'title';
        v_context := concat_ws(' · ', replace(to_char((v_row ->> 'amount')::numeric, 'FM999999990.00'), '.', ',') || ' zł',
                               v_row ->> 'vendor', v_row ->> 'expense_date');
      when 'budget_reports' then v_title := 'Raport budżetu ' || (v_row ->> 'period');
      when 'signing_documents' then
        v_title := v_row ->> 'title';
        v_context := v_row ->> 'code';
      when 'case_attachments' then v_title := v_row ->> 'filename';
      when 'case_comments' then v_title := left(v_row ->> 'body', 160);
      else v_title := null;
    end case;
    if tg_table_name in ('case_attachments', 'case_comments') then
      select c.title into v_context from public.cases c where c.id = (v_row ->> 'case_id')::uuid;
    end if;
  end if;

  insert into public.trash_items
    (group_id, table_name, entity, is_root, row_key, row_data, relinks, storage_objects,
     title, context, deleted_by)
  values
    (v_group, tg_table_name, v_cfg.entity, v_root, v_key, v_row, v_relinks, v_storage,
     v_title, v_context, auth.uid());

  return old;
end;
$$;

revoke all on function public.trash_capture() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in select table_name from public.trash_entities loop
    execute format(
      'create trigger trash_capture before delete on public.%I for each row execute function public.trash_capture()',
      r.table_name);
  end loop;
end $$;

select public.trash_guard_triggers();

-- ============================================================================
-- 5. RPC: lista, przywrócenie, trwałe usunięcie
-- ============================================================================

create or replace function public.trash_assert_session()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.is_authenticated_active() and public.is_aal2()) then
    raise exception 'Brak dostępu' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.trash_assert_session() from public, anon, authenticated;

-- Pozycje kosza: Poseł/administrator widzi wszystko, pozostali to, co sami usunęli.
create or replace function public.trash_list()
returns table (
  group_id uuid,
  entity text,
  title text,
  context text,
  deleted_at timestamptz,
  purge_after timestamptz,
  deleted_by uuid,
  deleted_by_name text,
  items integer,
  files integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  perform public.trash_assert_session();
  return query
    select t.group_id, t.entity, t.title, t.context, t.deleted_at, t.purge_after, t.deleted_by,
           p.full_name,
           (select count(*)::integer from public.trash_items c where c.group_id = t.group_id and not c.is_root),
           (select coalesce(sum(cardinality(c.storage_objects)), 0)::integer
              from public.trash_items c where c.group_id = t.group_id)
      from public.trash_items t
      left join public.profiles p on p.id = t.deleted_by
     where t.is_root
       and t.purge_after > now()
       and (public.is_posel() or t.deleted_by = auth.uid())
     order by t.deleted_at desc;
end;
$$;

revoke all on function public.trash_list() from public, anon;
grant execute on function public.trash_list() to authenticated, service_role;

create or replace function public.trash_restore(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_root public.trash_items%rowtype;
  v_cols text;
  v_pk_match text;
  it record;
  rl jsonb;
begin
  perform public.trash_assert_session();

  select * into v_root from public.trash_items where group_id = p_group_id and is_root for update;
  if not found or v_root.purge_after <= now() then
    raise exception 'Nie znaleziono pozycji w koszu' using errcode = 'P0002';
  end if;
  if not (public.is_posel() or v_root.deleted_by = auth.uid()) then
    raise exception 'Brak dostępu' using errcode = '42501';
  end if;

  perform set_config('eposel.trash_restoring', 'on', true);

  begin
    for it in
      select t.table_name, t.row_data
        from public.trash_items t
        join public.trash_entities e on e.table_name = t.table_name
       where t.group_id = p_group_id
       order by e.restore_order, t.id
    loop
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
        from pg_attribute a
       where a.attrelid = ('public.' || quote_ident(it.table_name))::regclass
         and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
      execute format(
        'insert into public.%I (%s) overriding system value select %s from jsonb_populate_record(null::public.%I, $1)',
        it.table_name, v_cols, v_cols, it.table_name)
        using it.row_data;
    end loop;

    -- Ponowne podpięcie wierszy wyzerowanych przez `on delete set null` (tylko tych, które
    -- nadal istnieją i nie dostały w międzyczasie innej wartości).
    for rl in
      select x from public.trash_items t, jsonb_array_elements(t.relinks) x where t.group_id = p_group_id
    loop
      select string_agg(format('t.%1$I = k.%1$I', a.attname), ' and ') into v_pk_match
        from pg_index i
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
       where i.indrelid = (rl ->> 'table')::regclass and i.indisprimary;
      execute format(
        'update %s t set %I = %L from jsonb_populate_recordset(null::%s, $1) k where %s and t.%I is null',
        rl ->> 'table', rl ->> 'column', rl ->> 'value', rl ->> 'table', v_pk_match, rl ->> 'column')
        using rl -> 'keys';
    end loop;
  exception
    when foreign_key_violation then
      raise exception 'Nie można przywrócić: powiązany rekord już nie istnieje (np. sprawa nadrzędna - przywróć ją najpierw)'
        using errcode = '23503';
    when unique_violation then
      raise exception 'Nie można przywrócić: rekord o tym identyfikatorze już istnieje' using errcode = '23505';
  end;

  perform set_config('eposel.trash_restoring', '', true);

  delete from public.trash_items where group_id = p_group_id;

  perform public.log_audit('trash.restore', v_root.entity,
    case when v_root.row_key ->> 'id' ~ '^[0-9a-f-]{36}$' then (v_root.row_key ->> 'id')::uuid end,
    jsonb_build_object('title', v_root.title, 'deleted_at', v_root.deleted_at));

  return jsonb_build_object('entity', v_root.entity, 'id', v_root.row_key ->> 'id');
end;
$$;

revoke all on function public.trash_restore(uuid) from public, anon;
grant execute on function public.trash_restore(uuid) to authenticated, service_role;

-- „Cofnij” zaraz po usunięciu: ostatnie usunięcie danego rekordu.
create or replace function public.trash_restore_row(p_entity text, p_row_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_group uuid;
begin
  perform public.trash_assert_session();
  select t.group_id into v_group
    from public.trash_items t
   where t.is_root and t.entity = p_entity and t.row_key ->> 'id' = p_row_id
   order by t.deleted_at desc
   limit 1;
  if v_group is null then
    raise exception 'Nie znaleziono pozycji w koszu' using errcode = 'P0002';
  end if;
  return public.trash_restore(v_group);
end;
$$;

revoke all on function public.trash_restore_row(text, text) from public, anon;
grant execute on function public.trash_restore_row(text, text) to authenticated, service_role;

-- Trwałe usunięcie z kosza (Poseł/administrator). Pliki usuwa nocne sprzątanie sierot.
create or replace function public.trash_purge(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_root public.trash_items%rowtype;
begin
  perform public.trash_assert_session();
  if not public.is_posel() then
    raise exception 'Trwale usuwać może tylko Poseł lub administrator' using errcode = '42501';
  end if;
  select * into v_root from public.trash_items where group_id = p_group_id and is_root;
  if not found then
    raise exception 'Nie znaleziono pozycji w koszu' using errcode = 'P0002';
  end if;
  delete from public.trash_items where group_id = p_group_id;
  perform public.log_audit('trash.purge', v_root.entity,
    case when v_root.row_key ->> 'id' ~ '^[0-9a-f-]{36}$' then (v_root.row_key ->> 'id')::uuid end,
    jsonb_build_object('title', v_root.title));
end;
$$;

revoke all on function public.trash_purge(uuid) from public, anon;
grant execute on function public.trash_purge(uuid) to authenticated, service_role;

create or replace function public.trash_empty()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_rows integer;
begin
  perform public.trash_assert_session();
  if not public.is_posel() then
    raise exception 'Opróżnić kosz może tylko Poseł lub administrator' using errcode = '42501';
  end if;
  select count(*) into v_rows from public.trash_items where is_root;
  delete from public.trash_items where true;
  if v_rows > 0 then
    perform public.log_audit('trash.empty', 'trash', null, jsonb_build_object('items', v_rows));
  end if;
  return v_rows;
end;
$$;

revoke all on function public.trash_empty() from public, anon;
grant execute on function public.trash_empty() to authenticated, service_role;

-- ============================================================================
-- 6. Pliki: kosz chroni przed sprzątaniem sierot
-- ============================================================================

create or replace function public.case_attachments_orphan_objects(max_rows integer)
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'case-attachments'
     and o.created_at < now() - interval '1 day'
     and not exists (select 1 from public.case_attachments ca where ca.storage_path = o.name)
     and not exists (select 1 from public.trash_items t where t.storage_objects @> array['case-attachments/' || o.name])
   order by o.created_at
   limit greatest(coalesce(max_rows, 0), 0);
$$;

create or replace function public.receipts_orphan_objects(max_rows integer)
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'receipts'
     and o.created_at < now() - interval '7 days'
     and not exists (select 1 from public.office_expenses e where e.receipt_path = o.name)
     and not exists (select 1 from public.trash_items t where t.storage_objects @> array['receipts/' || o.name])
   order by o.created_at
   limit greatest(coalesce(max_rows, 0), 0);
$$;

create or replace function public.signing_orphan_objects(max_rows integer)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'signing-documents'
     and o.created_at < now() - interval '1 day'
     and not exists (select 1 from public.signing_document_files f where f.storage_path = o.name)
     and not exists (select 1 from public.trash_items t where t.storage_objects @> array['signing-documents/' || o.name])
   order by o.created_at
   limit greatest(coalesce(max_rows, 0), 0);
$$;

-- Systemowe usuwanie plików anulowanych dokumentów (po 30 dniach) omija kosz.
create or replace function public.signing_purge_cancelled()
returns integer
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_rows integer;
begin
  perform set_config('eposel.trash_skip', 'on', true);
  delete from public.signing_document_files f
   using public.signing_documents d
   where d.id = f.document_id
     and d.status = 'anulowany'
     and d.cancelled_at < now() - interval '30 days';
  get diagnostics v_rows = row_count;
  perform set_config('eposel.trash_skip', '', true);
  if v_rows > 0 then
    perform public.log_audit('signing.purge_cancelled', 'signing_document', null,
      jsonb_build_object('files', v_rows));
  end if;
  return v_rows;
end;
$$;

-- ============================================================================
-- 7. Retencja 7 dni (przed nocnym sprzątaniem sierot o 03:30)
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('trash-retention', '0 3 * * *',
      $job$delete from public.trash_items where purge_after < now()$job$);
  end if;
end $$;

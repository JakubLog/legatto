-- Dokumenty do podpisu: obieg pism przygotowanych przez biuro do podpisu Posła.
--
-- Model:
--   - Pracownik (is_writer) wgrywa oryginał (PDF zalecany, DOCX dozwolony) do bucketu
--     `signing-documents` pod ścieżkę `{document_id}/oryginal/v{n}-{file_id}.{ext}`, a potem
--     woła `signing_create_documents()`. Identyfikatory dokumentu i pliku nadaje klient, bo
--     ścieżka pliku powstaje przed wierszem w bazie.
--   - Poseł/administrator (is_posel) pobiera dokumenty paczkami ZIP po 20
--     (`signing_create_batch()` - status `pobrany`, ślad paczki), podpisuje je poza systemem
--     i wgrywa podpisane pliki do `{document_id}/podpisane/v{n}-{file_id}.{ext}`
--     (`signing_attach_signed()` - wszystko albo nic). Może też zwrócić dokument do poprawy,
--     oznaczyć wysłanie poza systemem albo usunąć dokument.
--   - `requires_signature = false` = załącznik bez podpisu: od razu status `podpisany`
--     (gotowy do wysyłki), `signed_at` puste.
--   - Widoczność jak w module „Sprawy” (`current_cases_scope()`): Poseł/administrator i zakres
--     „wszystkie” widzą wszystko, pozostali tylko własne dokumenty.
--   - Zapis wyłącznie przez RPC SECURITY DEFINER poniżej (brak grantów INSERT/UPDATE/DELETE dla
--     authenticated); każde RPC wymaga aktywnego konta i aal2, pilnuje przejść statusów pod
--     blokadą wiersza i zapisuje audyt (`signing.*`, metadane bez treści pism).
--   - Powiadomienia: kategoria `dokumenty`, rodzaje `signing_request`, `signing_decision`.
--     Jedno powiadomienie na wywołanie i odbiorcę (liczba + do 5 tytułów).
--   - Pliki: niezmienne (brak UPDATE/DELETE w buckecie dla klienta). Obiekty bez wiersza
--     `signing_document_files` usuwa cron przez `signing_orphan_objects()`; pliki dokumentów
--     anulowanych ponad 30 dni temu odpina `signing_purge_cancelled()` (wołane z crona przed
--     sprzątaniem sierot).

-- ============================================================================
-- 1. Sekwencje i tabele
-- ============================================================================

create sequence if not exists public.signing_documents_code_seq;
create sequence if not exists public.signing_batches_code_seq;

create table if not exists public.signing_batches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
    default ('PACZKA-' || lpad(nextval('public.signing_batches_code_seq')::text, 6, '0')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  document_count integer not null check (document_count between 1 and 20)
);

create table if not exists public.signing_documents (
  id uuid primary key,
  code text not null unique
    default ('DP-' || lpad(nextval('public.signing_documents_code_seq')::text, 6, '0')),
  title text not null check (char_length(btrim(title)) between 3 and 200),
  description text check (char_length(description) <= 2000),
  recipient_name text check (char_length(recipient_name) <= 300),
  send_subject text check (char_length(send_subject) <= 255),
  send_text text check (char_length(send_text) <= 5000),
  case_id uuid references public.cases(id) on delete set null,
  requires_signature boolean not null default true,
  status text not null default 'do_podpisu' check (status in (
    'do_podpisu', 'pobrany', 'do_poprawy', 'podpisany', 'wyslany', 'anulowany'
  )),
  current_version integer not null default 1 check (current_version between 1 and 999),
  return_notes text check (char_length(return_notes) <= 2000),
  due_date date,
  last_batch_id uuid references public.signing_batches(id) on delete set null,
  sent_manually boolean not null default false,
  sent_note text check (char_length(sent_note) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  signed_at timestamptz,
  signed_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz,
  cancelled_at timestamptz
);

create index if not exists signing_documents_status_idx on public.signing_documents (status);
create index if not exists signing_documents_created_by_idx on public.signing_documents (created_by);
create index if not exists signing_documents_case_idx on public.signing_documents (case_id) where case_id is not null;
create index if not exists signing_documents_created_idx on public.signing_documents (created_at desc);
create index if not exists signing_documents_cancelled_idx
  on public.signing_documents (cancelled_at) where status = 'anulowany';

create table if not exists public.signing_document_files (
  id uuid primary key,
  document_id uuid not null references public.signing_documents(id) on delete cascade,
  kind text not null check (kind in ('oryginal', 'podpisany', 'podpis_zewnetrzny')),
  version integer not null check (version between 1 and 999),
  storage_path text not null unique check (char_length(storage_path) <= 200),
  filename text not null check (char_length(filename) between 1 and 255),
  mime_type text not null check (char_length(mime_type) between 1 and 100),
  size_bytes bigint not null check (
    size_bytes > 0
    and size_bytes <= 15728640
    and (kind <> 'podpis_zewnetrzny' or size_bytes <= 1048576)
  ),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  is_current boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists signing_document_files_document_idx on public.signing_document_files (document_id);
-- Jeden bieżący oryginał i co najwyżej jeden bieżący plik podpisu na dokument.
create unique index if not exists signing_document_files_current_original_key
  on public.signing_document_files (document_id)
  where is_current and kind = 'oryginal';
create unique index if not exists signing_document_files_current_signature_key
  on public.signing_document_files (document_id)
  where is_current and kind in ('podpisany', 'podpis_zewnetrzny');

create table if not exists public.signing_batch_items (
  batch_id uuid not null references public.signing_batches(id) on delete cascade,
  document_id uuid not null references public.signing_documents(id) on delete cascade,
  -- set null: sprzątanie plików anulowanych dokumentów (signing_purge_cancelled) nie może
  -- zablokować się na historii paczek.
  file_id uuid references public.signing_document_files(id) on delete set null,
  zip_name text not null check (zip_name ~ '^[A-Za-z0-9._-]{1,128}$'),
  position integer not null check (position between 1 and 20),
  primary key (batch_id, document_id)
);

create index if not exists signing_batch_items_document_idx on public.signing_batch_items (document_id);

alter sequence public.signing_documents_code_seq owned by public.signing_documents.code;
alter sequence public.signing_batches_code_seq owned by public.signing_batches.code;

-- Triggery wspólne (created_by z sesji i niezmienne, updated_at) - jak 20261018210000.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['signing_documents', 'signing_document_files', 'signing_batches']
  loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_set_created_by', v_table);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.set_created_by()',
      v_table || '_set_created_by', v_table
    );
    execute format('drop trigger if exists %I on public.%I', v_table || '_keep_created_by', v_table);
    execute format(
      'create trigger %I before update of created_by on public.%I for each row execute function public.set_created_by()',
      v_table || '_keep_created_by', v_table
    );
  end loop;
end $$;

drop trigger if exists signing_documents_set_updated_at on public.signing_documents;
create trigger signing_documents_set_updated_at
before update on public.signing_documents
for each row execute function public.set_updated_at();

-- ============================================================================
-- 2. Widoczność i RLS
-- ============================================================================

-- Zakres „Sprawy”: Poseł/administrator, zakres „wszystkie” albo własny dokument.
create or replace function public.signing_can_read(p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select public.is_posel()
    or public.current_cases_scope() = 'all'
    or (p_created_by is not null and p_created_by = auth.uid())
$$;

revoke all on function public.signing_can_read(uuid) from public, anon;
grant execute on function public.signing_can_read(uuid) to authenticated, service_role;

alter table public.signing_documents enable row level security;
alter table public.signing_document_files enable row level security;
alter table public.signing_batches enable row level security;
alter table public.signing_batch_items enable row level security;

revoke all on public.signing_documents from public, anon, authenticated;
revoke all on public.signing_document_files from public, anon, authenticated;
revoke all on public.signing_batches from public, anon, authenticated;
revoke all on public.signing_batch_items from public, anon, authenticated;
grant select on public.signing_documents to authenticated;
grant select on public.signing_document_files to authenticated;
grant select on public.signing_batches to authenticated;
grant select on public.signing_batch_items to authenticated;
grant all on public.signing_documents to service_role;
grant all on public.signing_document_files to service_role;
grant all on public.signing_batches to service_role;
grant all on public.signing_batch_items to service_role;

revoke all on sequence public.signing_documents_code_seq from public, anon, authenticated;
revoke all on sequence public.signing_batches_code_seq from public, anon, authenticated;
grant usage, select on sequence public.signing_documents_code_seq to service_role;
grant usage, select on sequence public.signing_batches_code_seq to service_role;

drop policy if exists signing_documents_select on public.signing_documents;
create policy signing_documents_select
on public.signing_documents for select
to authenticated
using (
  public.is_authenticated_active()
  and public.signing_can_read(created_by)
  and public.is_aal2()
);

drop policy if exists signing_document_files_select on public.signing_document_files;
create policy signing_document_files_select
on public.signing_document_files for select
to authenticated
using (
  public.is_authenticated_active()
  and exists (
    select 1 from public.signing_documents d
     where d.id = signing_document_files.document_id
       and public.signing_can_read(d.created_by)
  )
  and public.is_aal2()
);

drop policy if exists signing_batches_select on public.signing_batches;
create policy signing_batches_select
on public.signing_batches for select
to authenticated
using (public.is_posel() and public.is_aal2());

drop policy if exists signing_batch_items_select on public.signing_batch_items;
create policy signing_batch_items_select
on public.signing_batch_items for select
to authenticated
using (public.is_posel() and public.is_aal2());

-- ============================================================================
-- 3. Storage: bucket signing-documents
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'signing-documents',
  'signing-documents',
  false,
  15728640,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/xml',
    'application/pkcs7-signature',
    'application/pkcs7-mime',
    'application/vnd.etsi.asic-e+zip',
    'application/vnd.etsi.asic-s+zip'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- SELECT: istnieje widoczny (RLS signing_document_files_select) wiersz pliku o tej ścieżce.
drop policy if exists "signing_documents_read" on storage.objects;
create policy "signing_documents_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'signing-documents'
    and public.is_authenticated_active()
    and exists (
      select 1 from public.signing_document_files f
       where f.storage_path = objects.name
    )
    and public.is_aal2()
  );

-- INSERT oryginału: piszący; ścieżka {document_id}/oryginal/v{n}-{file_id}.{pdf|docx}.
drop policy if exists "signing_documents_upload_original" on storage.objects;
create policy "signing_documents_upload_original"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'signing-documents'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/oryginal/v[1-9][0-9]{0,2}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|docx)$'
    and public.is_writer()
    and public.is_aal2()
  );

-- INSERT pliku podpisu: Poseł/administrator; ścieżka {document_id}/podpisane/v{n}-{file_id}.{ext}.
drop policy if exists "signing_documents_upload_signed" on storage.objects;
create policy "signing_documents_upload_signed"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'signing-documents'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/podpisane/v[1-9][0-9]{0,2}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|xml|xades|p7s|sig|p7m|asice|asics)$'
    and public.is_posel()
    and public.is_aal2()
  );

-- Sieroty: obiekty starsze niż 1 dzień bez wiersza signing_document_files (porzucony formularz,
-- nieudane RPC, usunięty dokument, pliki odpięte przez signing_purge_cancelled). Usuwa je cron
-- /api/cron/poliai-purge przez Storage API (jak receipts_orphan_objects z 20261107910000).
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
   order by o.created_at
   limit greatest(coalesce(max_rows, 0), 0);
$$;

revoke all on function public.signing_orphan_objects(integer) from public, anon, authenticated;
grant execute on function public.signing_orphan_objects(integer) to service_role;

-- Pliki dokumentów anulowanych ponad 30 dni temu (D7): wiersze plików znikają, obiekty stają się
-- sierotami dla signing_orphan_objects(). Zwraca liczbę odpiętych plików. Tylko service_role (cron).
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
  delete from public.signing_document_files f
   using public.signing_documents d
   where d.id = f.document_id
     and d.status = 'anulowany'
     and d.cancelled_at < now() - interval '30 days';
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    perform public.log_audit('signing.purge_cancelled', 'signing_document', null,
      jsonb_build_object('files', v_rows));
  end if;
  return v_rows;
end;
$$;

revoke all on function public.signing_purge_cancelled() from public, anon, authenticated;
grant execute on function public.signing_purge_cancelled() to service_role;

-- ============================================================================
-- 4. Pomocnicze (wewnętrzne, bez grantów dla klienta)
-- ============================================================================

-- Aktywne konto + aal2.
create or replace function public.signing_assert_session()
returns void
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  if auth.uid() is null or not public.is_authenticated_active() then
    raise exception 'Brak dostępu' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;
end;
$$;

-- Slug do nazw w ZIP: małe litery [a-z0-9-], bez polskich znaków, do 60 znaków, pusty = 'dokument'.
-- Ta sama reguła co w src/lib/signing.ts.
create or replace function public.signing_slug(p_title text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text;
begin
  v := translate(lower(coalesce(p_title, '')), 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ', 'acelnoszzacelnoszz');
  v := btrim(regexp_replace(v, '[^a-z0-9]+', '-', 'g'), '-');
  v := rtrim(left(v, 60), '-');
  return case when v = '' then 'dokument' else v end;
end;
$$;

-- MIME dla rozszerzenia z allow-listy (mapa jak w buckecie i kliencie); NULL = niedozwolone.
create or replace function public.signing_ext_mime(p_ext text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_ext
    when 'pdf' then 'application/pdf'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'xml' then 'application/xml'
    when 'xades' then 'application/xml'
    when 'p7s' then 'application/pkcs7-signature'
    when 'sig' then 'application/pkcs7-signature'
    when 'p7m' then 'application/pkcs7-mime'
    when 'asice' then 'application/vnd.etsi.asic-e+zip'
    when 'asics' then 'application/vnd.etsi.asic-s+zip'
  end
$$;

-- UUID z pola JSON (tekst, małe litery jak crypto.randomUUID).
create or replace function public.signing_json_uuid(p_value jsonb, p_label text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
  if jsonb_typeof(p_value) is distinct from 'string'
     or (p_value #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception '%: nieprawidłowy identyfikator', p_label using errcode = '22023';
  end if;
  return (p_value #>> '{}')::uuid;
end;
$$;

-- Liczba całkowita nieujemna z pola JSON.
create or replace function public.signing_json_int(p_value jsonb, p_label text)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
begin
  if jsonb_typeof(p_value) is distinct from 'number' or (p_value #>> '{}') !~ '^[0-9]{1,12}$' then
    raise exception '%: oczekiwano liczby całkowitej', p_label using errcode = '22023';
  end if;
  return (p_value #>> '{}')::bigint;
end;
$$;

-- Opcjonalny tekst z pola JSON: brak/null/pusty = NULL, dłuższy niż p_max = błąd.
create or replace function public.signing_json_text(p_value jsonb, p_max integer, p_label text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    raise exception '%: oczekiwano tekstu', p_label using errcode = '22023';
  end if;
  v := btrim(p_value #>> '{}');
  if v = '' then
    return null;
  end if;
  if char_length(v) > p_max then
    raise exception '%: najwyżej % znaków', p_label, p_max using errcode = '22023';
  end if;
  return v;
end;
$$;

-- Tytuł dokumentu: 3-200 znaków.
create or replace function public.signing_json_title(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := public.signing_json_text(p_value, 200, 'Tytuł');
begin
  if v is null or char_length(v) < 3 then
    raise exception 'Tytuł: od 3 do 200 znaków' using errcode = '22023';
  end if;
  return v;
end;
$$;

-- Termin (YYYY-MM-DD), opcjonalny.
create or replace function public.signing_json_date(p_value jsonb)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := public.signing_json_text(p_value, 10, 'Termin');
begin
  if v is null then
    return null;
  end if;
  if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Termin: oczekiwano daty RRRR-MM-DD' using errcode = '22023';
  end if;
  begin
    return v::date;
  exception when others then
    raise exception 'Termin: nieprawidłowa data' using errcode = '22023';
  end;
end;
$$;

-- Powiązana sprawa (opcjonalna): musi istnieć i być widoczna dla wołającego (jak cases_select).
create or replace function public.signing_json_case(p_value jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_id uuid;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  v_id := public.signing_json_uuid(p_value, 'Sprawa');
  if not exists (
    select 1 from public.cases c
     where c.id = v_id
       and (public.is_posel() or public.current_cases_scope() = 'all'
            or c.created_by = auth.uid() or c.assigned_to = auth.uid())
  ) then
    raise exception 'Nie znaleziono sprawy' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- Walidacja opisu pliku { file_id, storage_path, filename, mime_type, size_bytes, sha256 }:
-- ścieżka {document_id}/{katalog}/v{wersja}-{file_id}.{ext}, ext z allow-listy, MIME z mapy,
-- rozmiar, SHA-256, obiekt istnieje w buckecie (i zgadza się rozmiar), plik nie jest podpięty.
create or replace function public.signing_validate_file(
  p_document_id uuid,
  p_dir text,
  p_version integer,
  p_file jsonb,
  p_allowed_ext text[],
  p_max_bytes bigint,
  out file_id uuid,
  out storage_path text,
  out filename text,
  out mime_type text,
  out size_bytes bigint,
  out sha256 text
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_id uuid;
  v_path text;
  v_prefix text;
  v_ext text;
  v_name text;
  v_mime text;
  v_size bigint;
  v_sha text;
  v_meta jsonb;
begin
  if jsonb_typeof(p_file) is distinct from 'object' then
    raise exception 'Brak opisu pliku' using errcode = '22023';
  end if;

  v_id := public.signing_json_uuid(p_file -> 'file_id', 'Plik');

  if jsonb_typeof(p_file -> 'storage_path') is distinct from 'string' then
    raise exception 'Plik: brak ścieżki' using errcode = '22023';
  end if;
  v_path := p_file ->> 'storage_path';
  v_prefix := p_document_id::text || '/' || p_dir || '/v' || p_version || '-' || v_id::text || '.';
  if char_length(v_path) > 200 or left(v_path, char_length(v_prefix)) <> v_prefix then
    raise exception 'Plik: nieprawidłowa ścieżka' using errcode = '22023';
  end if;
  v_ext := substr(v_path, char_length(v_prefix) + 1);
  if not (v_ext = any (p_allowed_ext)) then
    raise exception 'Plik: niedozwolony typ (.%)', left(v_ext, 10) using errcode = '22023';
  end if;

  v_name := public.signing_json_text(p_file -> 'filename', 255, 'Nazwa pliku');
  if v_name is null or v_name ~ '[[:cntrl:]]' then
    raise exception 'Nazwa pliku: od 1 do 255 znaków, bez znaków sterujących' using errcode = '22023';
  end if;

  v_mime := public.signing_ext_mime(v_ext);
  if jsonb_typeof(p_file -> 'mime_type') is distinct from 'string' or (p_file ->> 'mime_type') <> v_mime then
    raise exception 'Plik: typ MIME niezgodny z rozszerzeniem' using errcode = '22023';
  end if;

  v_size := public.signing_json_int(p_file -> 'size_bytes', 'Rozmiar pliku');
  if v_size < 1 or v_size > p_max_bytes then
    raise exception 'Plik: rozmiar od 1 B do % MB', round(p_max_bytes / 1048576.0) using errcode = '22023';
  end if;

  if jsonb_typeof(p_file -> 'sha256') is distinct from 'string' or (p_file ->> 'sha256') !~ '^[0-9a-f]{64}$' then
    raise exception 'Plik: nieprawidłowa suma SHA-256' using errcode = '22023';
  end if;
  v_sha := p_file ->> 'sha256';

  select o.metadata into v_meta
    from storage.objects o
   where o.bucket_id = 'signing-documents' and o.name = v_path;
  if not found then
    raise exception 'Plik nie został wgrany do magazynu' using errcode = '22023';
  end if;
  if (v_meta ->> 'size') ~ '^[0-9]+$' and (v_meta ->> 'size')::bigint <> v_size then
    raise exception 'Plik: rozmiar niezgodny z wgranym plikiem' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.signing_document_files f
     where f.id = v_id or f.storage_path = v_path
  ) then
    raise exception 'Plik jest już podpięty' using errcode = '22023';
  end if;

  file_id := v_id;
  storage_path := v_path;
  filename := v_name;
  mime_type := v_mime;
  size_bytes := v_size;
  sha256 := v_sha;
end;
$$;

-- Lista identyfikatorów: bez NULL i duplikatów, 1..p_max.
create or replace function public.signing_ids(p_ids uuid[], p_max integer)
returns uuid[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v uuid[];
begin
  v := array(select distinct x from unnest(coalesce(p_ids, '{}'::uuid[])) as t(x) where x is not null);
  if cardinality(v) = 0 or cardinality(v) > p_max then
    raise exception 'Wybierz od 1 do % dokumentów', p_max using errcode = '22023';
  end if;
  return v;
end;
$$;

-- Powiadomienie signing_request: aktywni Poseł/administrator poza aktorem, jedno na wywołanie.
-- Błąd powiadomień nie przerywa operacji.
create or replace function public.signing_notify_request(p_document_ids uuid[], p_revised boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_count integer;
  v_first uuid;
  v_version integer;
  v_titles text[];
  v_payload jsonb;
begin
  begin
    select count(*),
           (array_agg(d.id order by d.created_at, d.code))[1],
           (array_agg(d.current_version order by d.created_at, d.code))[1],
           (array_agg(d.title order by d.created_at, d.code))[1:5]
      into v_count, v_first, v_version, v_titles
      from public.signing_documents d
     where d.id = any (p_document_ids)
       and d.requires_signature;
    if coalesce(v_count, 0) = 0 then
      return;
    end if;

    v_payload := jsonb_build_object(
      'count', v_count,
      'titles', to_jsonb(v_titles),
      'actor_name', public.notification_actor_name(v_actor),
      'document_id', v_first,
      'revised', coalesce(p_revised, false)
    ) || case when nullif(btrim(p_note), '') is not null
              then jsonb_build_object('note', left(btrim(p_note), 600)) else '{}'::jsonb end;

    perform public.notify(r.id, 'signing_request', v_payload, 'sign-req:' || v_first || ':' || v_version)
      from public.profiles r
     where r.is_active = true
       and r.role in ('posel', 'administrator')
       and r.id is distinct from v_actor;
  exception when others then
    raise warning 'signing_notify_request: %', sqlerrm;
  end;
end;
$$;

-- Powiadomienie signing_decision: autor dokumentu poza aktorem, jedno na autora i wywołanie.
create or replace function public.signing_notify_decision(p_document_ids uuid[], p_decision text, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text := public.notification_actor_name(auth.uid());
  v_extra jsonb := case when nullif(btrim(p_notes), '') is not null
                        then jsonb_build_object('notes', left(btrim(p_notes), 600)) else '{}'::jsonb end;
  r record;
begin
  if p_decision not in ('do_poprawy', 'podpisany', 'wyslany') then
    raise exception 'Nieznana decyzja: %', p_decision using errcode = '22023';
  end if;
  for r in
    select d.created_by as user_id,
           count(*) as cnt,
           (array_agg(d.id order by d.created_at, d.code))[1] as first_id,
           (array_agg(d.current_version order by d.created_at, d.code))[1] as first_version,
           (array_agg(d.title order by d.created_at, d.code))[1:5] as titles
      from public.signing_documents d
     where d.id = any (p_document_ids)
       and d.created_by is not null
       and d.created_by is distinct from v_actor
     group by d.created_by
  loop
    begin
      perform public.notify(r.user_id, 'signing_decision',
        jsonb_build_object(
          'decision', p_decision,
          'count', r.cnt,
          'titles', to_jsonb(r.titles),
          'actor_name', v_actor_name,
          'document_id', r.first_id
        ) || v_extra,
        'sign-dec:' || r.first_id || ':' || r.first_version || ':' || p_decision);
    exception when others then
      raise warning 'signing_notify_decision: %', sqlerrm;
    end;
  end loop;
end;
$$;

revoke all on function public.signing_assert_session() from public, anon, authenticated;
revoke all on function public.signing_slug(text) from public, anon, authenticated;
revoke all on function public.signing_ext_mime(text) from public, anon, authenticated;
revoke all on function public.signing_json_uuid(jsonb, text) from public, anon, authenticated;
revoke all on function public.signing_json_int(jsonb, text) from public, anon, authenticated;
revoke all on function public.signing_json_text(jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.signing_json_title(jsonb) from public, anon, authenticated;
revoke all on function public.signing_json_date(jsonb) from public, anon, authenticated;
revoke all on function public.signing_json_case(jsonb) from public, anon, authenticated;
revoke all on function public.signing_validate_file(uuid, text, integer, jsonb, text[], bigint) from public, anon, authenticated;
revoke all on function public.signing_ids(uuid[], integer) from public, anon, authenticated;
revoke all on function public.signing_notify_request(uuid[], boolean, text) from public, anon, authenticated;
revoke all on function public.signing_notify_decision(uuid[], text, text) from public, anon, authenticated;

-- ============================================================================
-- 5. RPC obiegu
-- ============================================================================

-- Nowe dokumenty (piszący). Pozycja: { id, title, description?, recipient_name?,
-- send_subject?, send_text?, case_id?, requires_signature?, due_date?, file }. Zwraca [{ id, code }].
create or replace function public.signing_create_documents(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_item jsonb;
  v_id uuid;
  v_code text;
  v_requires boolean;
  v_file record;
  v_ids uuid[] := '{}';
  v_result jsonb := '[]'::jsonb;
begin
  perform public.signing_assert_session();
  if not public.is_writer() then
    raise exception 'Brak uprawnień do dodawania dokumentów' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) not between 1 and 50 then
    raise exception 'Dodaj od 1 do 50 dokumentów naraz' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Nieprawidłowa pozycja' using errcode = '22023';
    end if;
    v_id := public.signing_json_uuid(v_item -> 'id', 'Dokument');
    if v_id = any (v_ids) or exists (select 1 from public.signing_documents d where d.id = v_id) then
      raise exception 'Dokument o tym identyfikatorze już istnieje' using errcode = '22023';
    end if;

    if v_item -> 'requires_signature' is null or jsonb_typeof(v_item -> 'requires_signature') = 'null' then
      v_requires := true;
    elsif jsonb_typeof(v_item -> 'requires_signature') = 'boolean' then
      v_requires := (v_item ->> 'requires_signature')::boolean;
    else
      raise exception 'Pole „wymaga podpisu” musi być wartością logiczną' using errcode = '22023';
    end if;

    select * into v_file
      from public.signing_validate_file(v_id, 'oryginal', 1, v_item -> 'file', array['pdf', 'docx'], 15728640);

    insert into public.signing_documents (
      id, title, description, recipient_name, send_subject, send_text,
      case_id, requires_signature, status, due_date
    ) values (
      v_id,
      public.signing_json_title(v_item -> 'title'),
      public.signing_json_text(v_item -> 'description', 2000, 'Opis'),
      public.signing_json_text(v_item -> 'recipient_name', 300, 'Adresat'),
      public.signing_json_text(v_item -> 'send_subject', 255, 'Temat wysyłki'),
      public.signing_json_text(v_item -> 'send_text', 5000, 'Treść wysyłki'),
      public.signing_json_case(v_item -> 'case_id'),
      v_requires,
      case when v_requires then 'do_podpisu' else 'podpisany' end,
      public.signing_json_date(v_item -> 'due_date')
    )
    returning code into v_code;

    insert into public.signing_document_files (
      id, document_id, kind, version, storage_path, filename, mime_type, size_bytes, sha256
    ) values (
      v_file.file_id, v_id, 'oryginal', 1, v_file.storage_path, v_file.filename,
      v_file.mime_type, v_file.size_bytes, v_file.sha256
    );

    perform public.log_audit('signing.create', 'signing_document', v_id, jsonb_build_object(
      'code', v_code, 'version', 1, 'requires_signature', v_requires, 'size_bytes', v_file.size_bytes));

    v_ids := v_ids || v_id;
    v_result := v_result || jsonb_build_array(jsonb_build_object('id', v_id, 'code', v_code));
  end loop;

  perform public.signing_notify_request(v_ids, false, null);
  return v_result;
end;
$$;

-- Zmiana metadanych (autor albo Poseł) w statusach przed wysyłką.
create or replace function public.signing_update_document(p_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_allowed constant text[] := array[
    'title', 'description', 'recipient_name', 'send_subject', 'send_text', 'case_id', 'due_date'];
  v_doc public.signing_documents%rowtype;
  v_key text;
  v_keys text[];
begin
  perform public.signing_assert_session();
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'Nieprawidłowe zmiany' using errcode = '22023';
  end if;
  v_keys := array(select jsonb_object_keys(p_patch));
  if cardinality(v_keys) = 0 then
    raise exception 'Brak zmian' using errcode = '22023';
  end if;
  foreach v_key in array v_keys loop
    if not (v_key = any (v_allowed)) then
      raise exception 'Pola % nie można zmienić', left(v_key, 40) using errcode = '22023';
    end if;
  end loop;

  select * into v_doc from public.signing_documents where id = p_id for update;
  if not found or not public.signing_can_read(v_doc.created_by) then
    raise exception 'Nie znaleziono dokumentu' using errcode = '22023';
  end if;
  if not (public.is_posel() or (public.is_writer() and v_doc.created_by = auth.uid())) then
    raise exception 'Dokument może zmienić autor albo Poseł' using errcode = '42501';
  end if;
  if v_doc.status not in ('do_podpisu', 'pobrany', 'do_poprawy', 'podpisany') then
    raise exception 'Dokumentu % w tym statusie nie można już zmienić', v_doc.code using errcode = '55000';
  end if;

  update public.signing_documents set
    title = case when p_patch ? 'title' then public.signing_json_title(p_patch -> 'title') else title end,
    description = case when p_patch ? 'description'
      then public.signing_json_text(p_patch -> 'description', 2000, 'Opis') else description end,
    recipient_name = case when p_patch ? 'recipient_name'
      then public.signing_json_text(p_patch -> 'recipient_name', 300, 'Adresat') else recipient_name end,
    send_subject = case when p_patch ? 'send_subject'
      then public.signing_json_text(p_patch -> 'send_subject', 255, 'Temat wysyłki') else send_subject end,
    send_text = case when p_patch ? 'send_text'
      then public.signing_json_text(p_patch -> 'send_text', 5000, 'Treść wysyłki') else send_text end,
    case_id = case when p_patch ? 'case_id' then public.signing_json_case(p_patch -> 'case_id') else case_id end,
    due_date = case when p_patch ? 'due_date' then public.signing_json_date(p_patch -> 'due_date') else due_date end
  where id = p_id;

  perform public.log_audit('signing.update', 'signing_document', p_id, jsonb_build_object(
    'code', v_doc.code, 'fields', to_jsonb(v_keys)));
end;
$$;

-- Nowa wersja oryginału (autor albo Poseł): poprzednie pliki przestają być bieżące, dokument wraca
-- do podpisu (albo do „gotowy do wysyłki”, gdy nie wymaga podpisu).
create or replace function public.signing_replace_original(p_id uuid, p_file jsonb, p_note text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_doc public.signing_documents%rowtype;
  v_version integer;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_file record;
begin
  perform public.signing_assert_session();
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'Notatka: najwyżej 2000 znaków' using errcode = '22023';
  end if;

  select * into v_doc from public.signing_documents where id = p_id for update;
  if not found or not public.signing_can_read(v_doc.created_by) then
    raise exception 'Nie znaleziono dokumentu' using errcode = '22023';
  end if;
  if not (public.is_posel() or (public.is_writer() and v_doc.created_by = auth.uid())) then
    raise exception 'Nową wersję może wgrać autor albo Poseł' using errcode = '42501';
  end if;
  if v_doc.status not in ('do_podpisu', 'pobrany', 'do_poprawy') then
    raise exception 'Dokumentu % w tym statusie nie można podmienić', v_doc.code using errcode = '55000';
  end if;
  v_version := v_doc.current_version + 1;
  if v_version > 999 then
    raise exception 'Osiągnięto limit wersji dokumentu' using errcode = '22023';
  end if;

  select * into v_file
    from public.signing_validate_file(p_id, 'oryginal', v_version, p_file, array['pdf', 'docx'], 15728640);

  update public.signing_document_files set is_current = false
   where document_id = p_id and is_current;

  insert into public.signing_document_files (
    id, document_id, kind, version, storage_path, filename, mime_type, size_bytes, sha256
  ) values (
    v_file.file_id, p_id, 'oryginal', v_version, v_file.storage_path, v_file.filename,
    v_file.mime_type, v_file.size_bytes, v_file.sha256
  );

  update public.signing_documents set
    current_version = v_version,
    status = case when requires_signature then 'do_podpisu' else 'podpisany' end,
    return_notes = null,
    signed_at = null,
    signed_by = null
  where id = p_id;

  perform public.log_audit('signing.replace', 'signing_document', p_id, jsonb_build_object(
    'code', v_doc.code, 'from_version', v_doc.current_version, 'version', v_version,
    'from_status', v_doc.status, 'size_bytes', v_file.size_bytes));

  perform public.signing_notify_request(array[p_id], true, v_note);
end;
$$;

-- Zwrot do poprawy z uwagami (Poseł).
create or replace function public.signing_return(p_ids uuid[], p_notes text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_ids uuid[];
  v_notes text := btrim(coalesce(p_notes, ''));
  v_found integer;
  r record;
begin
  perform public.signing_assert_session();
  if not public.is_posel() then
    raise exception 'Zwrócić dokument może tylko Poseł' using errcode = '42501';
  end if;
  if char_length(v_notes) not between 1 and 2000 then
    raise exception 'Uwagi: od 1 do 2000 znaków' using errcode = '22023';
  end if;
  v_ids := public.signing_ids(p_ids, 100);

  perform 1 from public.signing_documents where id = any (v_ids) order by id for update;
  select count(*) into v_found from public.signing_documents where id = any (v_ids);
  if v_found <> cardinality(v_ids) then
    raise exception 'Nie znaleziono dokumentu' using errcode = '22023';
  end if;
  for r in select code from public.signing_documents
            where id = any (v_ids) and status not in ('do_podpisu', 'pobrany', 'podpisany')
            order by code limit 1 loop
    raise exception 'Dokumentu % w tym statusie nie można zwrócić', r.code using errcode = '55000';
  end loop;

  update public.signing_documents set status = 'do_poprawy', return_notes = v_notes
   where id = any (v_ids);

  for r in select id, code, current_version, status from public.signing_documents where id = any (v_ids) loop
    perform public.log_audit('signing.return', 'signing_document', r.id, jsonb_build_object(
      'code', r.code, 'version', r.current_version, 'count', cardinality(v_ids)));
  end loop;

  perform public.signing_notify_decision(v_ids, 'do_poprawy', v_notes);
end;
$$;

-- Anulowanie: autor przed podpisem albo Poseł (także podpisany).
create or replace function public.signing_cancel(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_doc public.signing_documents%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.signing_assert_session();
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'Powód: najwyżej 1000 znaków' using errcode = '22023';
  end if;

  select * into v_doc from public.signing_documents where id = p_id for update;
  if not found or not public.signing_can_read(v_doc.created_by) then
    raise exception 'Nie znaleziono dokumentu' using errcode = '22023';
  end if;
  if public.is_posel() then
    if v_doc.status not in ('do_podpisu', 'pobrany', 'do_poprawy', 'podpisany') then
      raise exception 'Dokumentu % w tym statusie nie można anulować', v_doc.code using errcode = '55000';
    end if;
  elsif public.is_writer() and v_doc.created_by = auth.uid() then
    if v_doc.status not in ('do_podpisu', 'pobrany', 'do_poprawy') then
      raise exception 'Dokumentu % w tym statusie nie można anulować', v_doc.code using errcode = '55000';
    end if;
  else
    raise exception 'Dokument może anulować autor albo Poseł' using errcode = '42501';
  end if;

  update public.signing_documents set status = 'anulowany', cancelled_at = now()
   where id = p_id;

  perform public.log_audit('signing.cancel', 'signing_document', p_id, jsonb_build_object(
    'code', v_doc.code, 'from_status', v_doc.status, 'version', v_doc.current_version,
    'reason', left(v_reason, 500)));
end;
$$;

-- Paczka do pobrania (Poseł): 1..20 dokumentów wymagających podpisu w do_podpisu|pobrany.
-- Zwraca { batch_id, code, items: [{ document_id, file_id, storage_path, zip_name, position }] }.
create or replace function public.signing_create_batch(p_document_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_ids uuid[];
  v_found integer;
  v_batch_id uuid;
  v_batch_code text;
  v_pos integer := 0;
  v_file_id uuid;
  v_path text;
  v_zip text;
  v_items jsonb := '[]'::jsonb;
  v_codes text[] := '{}';
  r record;
begin
  perform public.signing_assert_session();
  if not public.is_posel() then
    raise exception 'Paczkę do podpisu może pobrać tylko Poseł' using errcode = '42501';
  end if;
  v_ids := public.signing_ids(p_document_ids, 20);

  perform 1 from public.signing_documents where id = any (v_ids) order by id for update;
  select count(*) into v_found from public.signing_documents where id = any (v_ids);
  if v_found <> cardinality(v_ids) then
    raise exception 'Nie znaleziono dokumentu' using errcode = '22023';
  end if;
  for r in select code from public.signing_documents
            where id = any (v_ids)
              and (status not in ('do_podpisu', 'pobrany') or not requires_signature)
            order by code limit 1 loop
    raise exception 'Dokument % nie czeka na podpis', r.code using errcode = '55000';
  end loop;

  insert into public.signing_batches (document_count)
  values (cardinality(v_ids))
  returning id, code into v_batch_id, v_batch_code;

  for r in select d.id, d.code, d.title, d.current_version
             from public.signing_documents d
            where d.id = any (v_ids)
            order by d.created_at, d.code loop
    select f.id, f.storage_path into v_file_id, v_path
      from public.signing_document_files f
     where f.document_id = r.id and f.kind = 'oryginal' and f.is_current and f.version = r.current_version;
    if not found then
      raise exception 'Dokument % nie ma bieżącego pliku', r.code using errcode = '55000';
    end if;
    v_pos := v_pos + 1;
    v_zip := r.code || '_v' || r.current_version || '_' || public.signing_slug(r.title) || '.'
      || substring(v_path from '\.([a-z0-9]+)$');

    insert into public.signing_batch_items (batch_id, document_id, file_id, zip_name, position)
    values (v_batch_id, r.id, v_file_id, v_zip, v_pos);

    v_codes := v_codes || r.code;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'document_id', r.id, 'file_id', v_file_id, 'storage_path', v_path,
      'zip_name', v_zip, 'position', v_pos));
  end loop;

  update public.signing_documents set status = 'pobrany', last_batch_id = v_batch_id
   where id = any (v_ids);

  perform public.log_audit('signing.batch_download', 'signing_batch', v_batch_id, jsonb_build_object(
    'code', v_batch_code, 'count', cardinality(v_ids), 'documents', to_jsonb(v_codes)));

  return jsonb_build_object('batch_id', v_batch_id, 'code', v_batch_code, 'items', v_items);
end;
$$;

-- Wgranie podpisanych plików (Poseł), wszystko albo nic. Pozycja:
-- { document_id, version, kind: 'podpisany'|'podpis_zewnetrzny', file }.
create or replace function public.signing_attach_signed(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_sig_ext constant text[] := array['pdf', 'xml', 'xades', 'p7s', 'sig', 'p7m', 'asice', 'asics'];
  v_item jsonb;
  v_doc_id uuid;
  v_version bigint;
  v_kind text;
  v_doc public.signing_documents%rowtype;
  v_file record;
  v_replaced integer;
  v_ids uuid[] := '{}';
begin
  perform public.signing_assert_session();
  if not public.is_posel() then
    raise exception 'Podpisane pliki może wgrać tylko Poseł' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) not between 1 and 40 then
    raise exception 'Wgraj od 1 do 40 plików naraz' using errcode = '22023';
  end if;

  -- Blokady w stałej kolejności (bez zakleszczeń przy równoległych wywołaniach).
  perform 1 from public.signing_documents
   where id in (
     select public.signing_json_uuid(value -> 'document_id', 'Dokument')
       from jsonb_array_elements(p_items)
   )
   order by id
   for update;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Nieprawidłowa pozycja' using errcode = '22023';
    end if;
    v_doc_id := public.signing_json_uuid(v_item -> 'document_id', 'Dokument');
    if v_doc_id = any (v_ids) then
      raise exception 'Jeden dokument może mieć jeden plik podpisu w operacji' using errcode = '22023';
    end if;
    v_version := public.signing_json_int(v_item -> 'version', 'Wersja');
    v_kind := v_item ->> 'kind';
    if jsonb_typeof(v_item -> 'kind') is distinct from 'string' or v_kind not in ('podpisany', 'podpis_zewnetrzny') then
      raise exception 'Nieprawidłowy rodzaj pliku podpisu' using errcode = '22023';
    end if;

    select * into v_doc from public.signing_documents where id = v_doc_id;
    if not found then
      raise exception 'Nie znaleziono dokumentu' using errcode = '22023';
    end if;
    if v_doc.status not in ('do_podpisu', 'pobrany', 'podpisany') then
      raise exception 'Dokument % w tym statusie nie przyjmuje podpisu', v_doc.code using errcode = '55000';
    end if;
    if v_version <> v_doc.current_version then
      raise exception 'Plik dla dokumentu % dotyczy nieaktualnej wersji (v%, bieżąca v%)',
        v_doc.code, v_version, v_doc.current_version using errcode = '55000';
    end if;

    select * into v_file
      from public.signing_validate_file(v_doc_id, 'podpisane', v_doc.current_version, v_item -> 'file', v_sig_ext,
        case when v_kind = 'podpis_zewnetrzny' then 1048576 else 15728640 end);

    update public.signing_document_files set is_current = false
     where document_id = v_doc_id and is_current and kind in ('podpisany', 'podpis_zewnetrzny');
    get diagnostics v_replaced = row_count;

    insert into public.signing_document_files (
      id, document_id, kind, version, storage_path, filename, mime_type, size_bytes, sha256
    ) values (
      v_file.file_id, v_doc_id, v_kind, v_doc.current_version, v_file.storage_path, v_file.filename,
      v_file.mime_type, v_file.size_bytes, v_file.sha256
    );

    update public.signing_documents set status = 'podpisany', signed_at = now(), signed_by = auth.uid()
     where id = v_doc_id;

    perform public.log_audit('signing.sign_upload', 'signing_document', v_doc_id, jsonb_build_object(
      'code', v_doc.code, 'version', v_doc.current_version, 'kind', v_kind,
      'replaced', v_replaced > 0, 'size_bytes', v_file.size_bytes));

    v_ids := v_ids || v_doc_id;
  end loop;

  perform public.signing_notify_decision(v_ids, 'podpisany', null);
end;
$$;

-- Oznaczenie wysłania poza systemem (Poseł): podpisany -> wyslany.
create or replace function public.signing_mark_sent(p_ids uuid[], p_sent_at timestamptz, p_note text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_ids uuid[];
  v_sent_at timestamptz := coalesce(p_sent_at, now());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_found integer;
  r record;
begin
  perform public.signing_assert_session();
  if not public.is_posel() then
    raise exception 'Wysłanie może oznaczyć tylko Poseł' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Notatka: najwyżej 1000 znaków' using errcode = '22023';
  end if;
  if v_sent_at > now() + interval '5 minutes' then
    raise exception 'Data wysłania nie może być w przyszłości' using errcode = '22023';
  end if;
  v_ids := public.signing_ids(p_ids, 100);

  perform 1 from public.signing_documents where id = any (v_ids) order by id for update;
  select count(*) into v_found from public.signing_documents where id = any (v_ids);
  if v_found <> cardinality(v_ids) then
    raise exception 'Nie znaleziono dokumentu' using errcode = '22023';
  end if;
  for r in select code from public.signing_documents
            where id = any (v_ids) and status <> 'podpisany'
            order by code limit 1 loop
    raise exception 'Dokument % nie jest gotowy do wysyłki', r.code using errcode = '55000';
  end loop;
  for r in select code from public.signing_documents
            where id = any (v_ids) and v_sent_at < created_at - interval '1 day'
            order by code limit 1 loop
    raise exception 'Data wysłania dokumentu % jest wcześniejsza niż jego dodanie', r.code using errcode = '22023';
  end loop;

  update public.signing_documents set
    status = 'wyslany', sent_manually = true, sent_at = v_sent_at, sent_note = v_note
   where id = any (v_ids);

  for r in select id, code, current_version from public.signing_documents where id = any (v_ids) loop
    perform public.log_audit('signing.mark_sent', 'signing_document', r.id, jsonb_build_object(
      'code', r.code, 'version', r.current_version, 'sent_at', v_sent_at, 'count', cardinality(v_ids)));
  end loop;

  perform public.signing_notify_decision(v_ids, 'wyslany', null);
end;
$$;

-- Usunięcie (Poseł): dokument w dowolnym statusie. Pliki w magazynie sprząta cron
-- (signing_orphan_objects).
create or replace function public.signing_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_doc public.signing_documents%rowtype;
  v_files integer;
begin
  perform public.signing_assert_session();
  if not public.is_posel() then
    raise exception 'Dokument może usunąć tylko Poseł' using errcode = '42501';
  end if;

  select * into v_doc from public.signing_documents where id = p_id for update;
  if not found then
    raise exception 'Nie znaleziono dokumentu' using errcode = '22023';
  end if;

  select count(*) into v_files from public.signing_document_files where document_id = p_id;
  perform public.log_audit('signing.delete', 'signing_document', p_id, jsonb_build_object(
    'code', v_doc.code, 'status', v_doc.status, 'version', v_doc.current_version, 'files', v_files));

  delete from public.signing_documents where id = p_id;
end;
$$;

revoke all on function public.signing_create_documents(jsonb) from public, anon;
revoke all on function public.signing_update_document(uuid, jsonb) from public, anon;
revoke all on function public.signing_replace_original(uuid, jsonb, text) from public, anon;
revoke all on function public.signing_return(uuid[], text) from public, anon;
revoke all on function public.signing_cancel(uuid, text) from public, anon;
revoke all on function public.signing_create_batch(uuid[]) from public, anon;
revoke all on function public.signing_attach_signed(jsonb) from public, anon;
revoke all on function public.signing_mark_sent(uuid[], timestamptz, text) from public, anon;
revoke all on function public.signing_delete(uuid) from public, anon;
grant execute on function public.signing_create_documents(jsonb) to authenticated;
grant execute on function public.signing_update_document(uuid, jsonb) to authenticated;
grant execute on function public.signing_replace_original(uuid, jsonb, text) to authenticated;
grant execute on function public.signing_return(uuid[], text) to authenticated;
grant execute on function public.signing_cancel(uuid, text) to authenticated;
grant execute on function public.signing_create_batch(uuid[]) to authenticated;
grant execute on function public.signing_attach_signed(jsonb) to authenticated;
grant execute on function public.signing_mark_sent(uuid[], timestamptz, text) to authenticated;
grant execute on function public.signing_delete(uuid) to authenticated;

-- ============================================================================
-- 6. Powiadomienia: katalog z kategorią „Dokumenty do podpisu”
-- ============================================================================

-- Jak w 20261109100000_notifications.sql + signing_request (tylko Poseł/administrator)
-- i signing_decision (zgodne z src/lib/notifications.ts).
create or replace function public.notification_catalog()
returns table (kind text, admin_only boolean, email_default boolean, push_default boolean, admin_default_only boolean)
language sql
immutable
set search_path = public
as $$
  values
    ('security_integration',    false, true,  true,  false),
    ('security_account',        false, true,  true,  false),
    ('case_assigned',           false, true,  true,  false),
    ('case_deadline',           false, true,  false, false),
    ('public_submission',       false, true,  true,  true),
    ('event_assigned',          false, true,  true,  false),
    ('interpellation_review',   true,  true,  true,  false),
    ('interpellation_decision', false, true,  true,  false),
    ('signing_request',         true,  true,  true,  false),
    ('signing_decision',        false, true,  true,  false),
    ('responsibility',          false, true,  true,  false),
    ('weekly_digest',           false, true,  false, false),
    ('daily_digest',            false, false, false, false)
$$;

revoke all on function public.notification_catalog() from public, anon, authenticated;

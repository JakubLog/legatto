-- ePosel - Załączniki do spraw wyborców
-- Bucket `case-attachments` (prywatny, 10 MB) + tabela `case_attachments`.
-- Wiele załączników per sprawa (osobna tabela z CASCADE DELETE).

-- ============================================================================
-- 1. Storage bucket (idempotent)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'case-attachments',
  'case-attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do nothing;

-- ============================================================================
-- 2. Storage policies (RLS na storage.objects)
-- ============================================================================

drop policy if exists "case_attachments_upload" on storage.objects;
create policy "case_attachments_upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'case-attachments'
    and is_writer()
    and is_aal2()
  );

drop policy if exists "case_attachments_read" on storage.objects;
create policy "case_attachments_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'case-attachments'
    and is_authenticated_active()
    and is_aal2()
  );

drop policy if exists "case_attachments_delete" on storage.objects;
create policy "case_attachments_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'case-attachments'
    and is_posel()
    and is_aal2()
  );

-- ============================================================================
-- 3. Tabela case_attachments
-- ============================================================================
create table if not exists public.case_attachments (
  id           uuid        primary key default gen_random_uuid(),
  case_id      uuid        not null references public.cases(id) on delete cascade,
  storage_path text        not null,
  filename     text        not null,
  mime_type    text        not null,
  size_bytes   bigint,
  created_by   uuid        references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.case_attachments enable row level security;

-- ============================================================================
-- 4. RLS na case_attachments
-- ============================================================================

-- SELECT: zalogowany aktywny + aal2 (powiązana widoczność spraw jest w cases_select)
drop policy if exists ca_select on public.case_attachments;
create policy ca_select on public.case_attachments
  for select to authenticated
  using (is_authenticated_active() and is_aal2());

-- INSERT: pracownik i poseł mogą dodawać
drop policy if exists ca_insert on public.case_attachments;
create policy ca_insert on public.case_attachments
  for insert to authenticated
  with check (is_writer() and is_aal2());

-- DELETE: tylko Poseł (spójnie z polityką delete na cases)
drop policy if exists ca_delete on public.case_attachments;
create policy ca_delete on public.case_attachments
  for delete to authenticated
  using (is_posel() and is_aal2());

-- ============================================================================
-- 5. Trigger set_created_by (auto auth.uid())
-- ============================================================================
drop trigger if exists case_attachments_set_created_by on public.case_attachments;
create trigger case_attachments_set_created_by
  before insert on public.case_attachments
  for each row execute function set_created_by();

-- ============================================================================
-- 6. Revoke anon
-- ============================================================================
revoke all on public.case_attachments from anon;

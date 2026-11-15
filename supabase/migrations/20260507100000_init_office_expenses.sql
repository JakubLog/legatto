-- ePosel - Faza 8: Budzet biura (rejestr wydatkow)
--
-- Pojedynczy globalny rejestr wydatkow biura poselskiego:
-- - dwie tabele: expense_categories (slownik) + office_expenses (wpisy)
-- - bucket Storage 'receipts' (prywatny, 5 MB, PDF + obrazy) na skany faktur
-- - RLS ze wszystkimi politykami zaopatrzonymi w is_aal2() (spojnie z innymi
--   wrazliwymi tabelami po migracji 20260504300000_rls_aal2_hardening)
-- - audit triggers (expense.create / update / delete)
--
-- Plan: ai-lib/plans/2026-05-07-modul-budzet-biura.md

-- ============================================================================
-- 1. KATEGORIE WYDATKOW
-- ============================================================================

create table public.expense_categories (
  id integer primary key generated always as identity,
  name text not null unique,
  slug text not null unique,
  color text,
  is_system boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index expense_categories_system_idx on public.expense_categories(is_system);

-- Seed (9 systemowych)
insert into public.expense_categories (name, slug, color, is_system) values
  ('Czynsz i media',           'czynsz-i-media',           'orange', true),
  ('Materialy biurowe',        'materialy-biurowe',        'blue',   true),
  ('Sprzet biurowy',           'sprzet-biurowy',           'cyan',   true),
  ('Wynagrodzenia',            'wynagrodzenia',            'purple', true),
  ('Transport / Paliwo',       'transport-paliwo',         'yellow', true),
  ('Komunikacja',              'komunikacja',              'teal',   true),
  ('Catering / Reprezentacja', 'catering-reprezentacja',   'red',    true),
  ('Druk / Materialy promocyjne', 'druk-materialy-promo',  'green',  true),
  ('Inne',                     'inne',                     'gray',   true);

-- ============================================================================
-- 2. WYDATKI
-- ============================================================================

create table public.office_expenses (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 200),
  description text,
  amount numeric(12,2) not null check (amount > 0),
  category_id integer references public.expense_categories(id) on delete set null,
  expense_date date not null,
  vendor text,
  invoice_number text,
  payment_method text check (payment_method in ('przelew','karta','gotowka','inne')),
  receipt_path text,
  receipt_mime text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index office_expenses_date_idx on public.office_expenses(expense_date desc);
create index office_expenses_category_idx on public.office_expenses(category_id);
create index office_expenses_created_idx on public.office_expenses(created_at desc);
create index office_expenses_search_idx on public.office_expenses using gin (
  to_tsvector('simple',
    coalesce(title, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(vendor, '') || ' ' ||
    coalesce(invoice_number, '')
  )
);

-- ============================================================================
-- 3. TRIGGERY
-- ============================================================================

create trigger office_expenses_set_updated_at
before update on public.office_expenses
for each row execute function public.set_updated_at();

create trigger office_expenses_set_created_by
before insert on public.office_expenses
for each row execute function public.set_created_by();

create or replace function public.office_expense_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit(
      'expense.create', 'office_expense', new.id,
      jsonb_build_object('title', new.title, 'amount', new.amount, 'expense_date', new.expense_date)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.log_audit(
      'expense.update', 'office_expense', new.id,
      jsonb_build_object('title', new.title, 'amount', new.amount)
    );
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_audit(
      'expense.delete', 'office_expense', old.id,
      jsonb_build_object('title', old.title, 'amount', old.amount)
    );
    return old;
  end if;
  return null;
end;
$$;

revoke execute on function public.office_expense_audit_trigger() from public, anon, authenticated;

create trigger office_expenses_audit
after insert or update or delete on public.office_expenses
for each row execute function public.office_expense_audit_trigger();

-- ============================================================================
-- 4. RLS expense_categories
-- ============================================================================

alter table public.expense_categories enable row level security;

create policy expense_categories_select_authenticated
on public.expense_categories for select
to authenticated
using (public.is_authenticated_active() and public.is_aal2());

create policy expense_categories_insert_writer
on public.expense_categories for insert
to authenticated
with check (public.is_writer() and public.is_aal2() and is_system = false);

create policy expense_categories_update_posel
on public.expense_categories for update
to authenticated
using (public.is_posel() and public.is_aal2() and is_system = false)
with check (public.is_posel() and public.is_aal2() and is_system = false);

create policy expense_categories_delete_posel
on public.expense_categories for delete
to authenticated
using (public.is_posel() and public.is_aal2() and is_system = false);

-- ============================================================================
-- 5. RLS office_expenses
-- ============================================================================

alter table public.office_expenses enable row level security;

create policy office_expenses_select_authenticated
on public.office_expenses for select
to authenticated
using (public.is_authenticated_active() and public.is_aal2());

create policy office_expenses_insert_writer
on public.office_expenses for insert
to authenticated
with check (public.is_writer() and public.is_aal2());

create policy office_expenses_update_writer
on public.office_expenses for update
to authenticated
using (public.is_writer() and public.is_aal2())
with check (public.is_writer() and public.is_aal2());

create policy office_expenses_delete_posel
on public.office_expenses for delete
to authenticated
using (public.is_posel() and public.is_aal2());

-- ============================================================================
-- 6. STORAGE BUCKET 'receipts' (prywatny)
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  5242880, -- 5 MB
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- SELECT - tylko aktywni czlonkowie zespolu z aal2
create policy "receipts_select_team"
on storage.objects for select
to authenticated
using (
  bucket_id = 'receipts'
  and public.is_authenticated_active()
  and public.is_aal2()
);

-- INSERT/UPDATE/DELETE we wlasnym folderze (path[0] = uid())
create policy "receipts_upload_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'receipts'
  and public.is_writer()
  and public.is_aal2()
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "receipts_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'receipts'
  and public.is_writer()
  and public.is_aal2()
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "receipts_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'receipts'
  and public.is_writer()
  and public.is_aal2()
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Posel - dowolny folder w bucketcie (admin override)
create policy "receipts_upload_posel"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'receipts'
  and public.is_posel()
  and public.is_aal2()
);

create policy "receipts_update_posel"
on storage.objects for update
to authenticated
using (
  bucket_id = 'receipts'
  and public.is_posel()
  and public.is_aal2()
);

create policy "receipts_delete_posel"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'receipts'
  and public.is_posel()
  and public.is_aal2()
);

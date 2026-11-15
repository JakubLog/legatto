-- PoliAI: zalaczniki wiadomosci (obrazy, PDF, DOCX, tekst).
--
-- Klient kompresuje plik w przegladarce i wgrywa obrazy stron do prywatnego bucketu
-- `poliai-attachments` (sciezka <user_id>/<attachment_id>/p<NNN>.<webp|jpg|png>), potem
-- /api/poliai?op=attachment sprawdza pliki, robi OCR (szybki model) i zapisuje wiersz w
-- poliai_attachments. Wyslanie wiadomosci przypina zalacznik do rozmowy (conversation_id) -
-- od tej chwili retencja jak rozmowa (cascade). Niewyslane zalaczniki usuwa
-- purge_expired_poliai_conversations() po 1 dniu, a pliki bez wiersza - cron poliai-purge
-- (poliai_orphan_attachment_objects). Plan: ai-lib/plans/2026-10-26-poliai-zalaczniki.md.

-- ============================================================================
-- 1. Storage bucket (idempotent)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'poliai-attachments',
  'poliai-attachments',
  false,
  5242880,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- ============================================================================
-- 2. Storage policies - tylko wlasny folder <user_id>/, role PoliAI (is_writer), aal2
-- ============================================================================
drop policy if exists "poliai_attachments_insert" on storage.objects;
create policy "poliai_attachments_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'poliai-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_writer()
    and public.is_aal2()
  );

drop policy if exists "poliai_attachments_select" on storage.objects;
create policy "poliai_attachments_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'poliai-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_writer()
    and public.is_aal2()
  );

drop policy if exists "poliai_attachments_delete" on storage.objects;
create policy "poliai_attachments_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'poliai-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_writer()
    and public.is_aal2()
  );

-- ============================================================================
-- 3. Tabela poliai_attachments
-- ============================================================================
create table public.poliai_attachments (
  -- uuid nadany przez klienta (folder w buckecie powstaje przed wierszem).
  id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- null do wyslania wiadomosci; potem retencja razem z rozmowa.
  conversation_id uuid references public.poliai_conversations (id) on delete cascade,
  name text not null,
  kind text not null,
  mime text not null,
  -- Bajty przed kompresja (plik uzytkownika) i po niej (obiekty w buckecie + tekst DOCX/TXT).
  original_size bigint not null,
  stored_size bigint not null,
  -- [{ path: string|null, text: string, source: 'pdf'|'ocr'|'file' }] - jedna pozycja na strone.
  pages jsonb not null,
  created_at timestamptz not null default now(),
  constraint poliai_attachments_name_len check (length(name) between 1 and 200),
  constraint poliai_attachments_kind check (kind in ('image', 'pdf', 'docx', 'text')),
  constraint poliai_attachments_mime_len check (length(mime) between 1 and 100),
  constraint poliai_attachments_original_size check (original_size >= 0),
  constraint poliai_attachments_stored_size check (stored_size >= 0),
  constraint poliai_attachments_pages_array check (jsonb_typeof(pages) = 'array')
);

create index poliai_attachments_conversation_idx
  on public.poliai_attachments (conversation_id);

create index poliai_attachments_user_created_idx
  on public.poliai_attachments (user_id, created_at);

alter table public.poliai_attachments enable row level security;

-- Podglad zalacznika w UI (tekst stron, sciezki obrazow) - tylko wlasne, aal2.
create policy poliai_attachments_select_own
  on public.poliai_attachments for select
  to authenticated
  using (user_id = auth.uid() and public.is_aal2());

-- Bez polityk INSERT/UPDATE/DELETE: zapis tylko service_role (serwer pilnuje wlasciciela i formatu).
revoke insert, update, delete on public.poliai_attachments from anon, authenticated;
grant select on public.poliai_attachments to authenticated;

-- ============================================================================
-- 4. Retencja
-- ============================================================================

-- Rozmowy bez aktywnosci od 90 dni (zalaczniki rozmow - cascade) oraz niewyslane zalaczniki
-- starsze niz 1 dzien. Zwraca laczna liczbe usunietych wierszy.
create or replace function public.purge_expired_poliai_conversations()
returns integer
language sql
security definer
set search_path = public
as $$
  with conversations as (
    delete from public.poliai_conversations
     where updated_at < now() - interval '90 days'
    returning 1
  ),
  attachments as (
    delete from public.poliai_attachments
     where conversation_id is null
       and created_at < now() - interval '1 day'
    returning 1
  )
  select ((select count(*) from conversations) + (select count(*) from attachments))::integer;
$$;

revoke all on function public.purge_expired_poliai_conversations() from public, anon, authenticated;
grant execute on function public.purge_expired_poliai_conversations() to service_role;

-- Pliki w buckecie starsze niz 1 dzien bez wiersza w poliai_attachments (niedokonczone
-- przygotowanie, usuniety zalacznik albo rozmowa). Usuwa je cron przez Storage API
-- (bezposredni DELETE na storage.objects zostawilby pliki w magazynie).
create or replace function public.poliai_orphan_attachment_objects(max_rows integer)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'poliai-attachments'
     and o.created_at < now() - interval '1 day'
     and not exists (
       select 1
         from public.poliai_attachments a
        -- Segment spoza formatu uuid nigdy nie pasuje (bez bledu rzutowania).
        where a.id = case
                       when (storage.foldername(o.name))[2]
                            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then ((storage.foldername(o.name))[2])::uuid
                     end
          and a.user_id::text = (storage.foldername(o.name))[1]
     )
   order by o.created_at
   limit greatest(coalesce(max_rows, 0), 0);
$$;

revoke all on function public.poliai_orphan_attachment_objects(integer) from public, anon, authenticated;
grant execute on function public.poliai_orphan_attachment_objects(integer) to service_role;

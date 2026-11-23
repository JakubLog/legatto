-- compat-n-1: safe
-- Legatto (A12): blog posła - tabela posts + zdjęcia w site-assets/blog/.
--
-- Wpisy powstają w CRM (/biuro/admin/blog, edytor Markdown bez surowego HTML) i trafiają na
-- statyczną stronę posła przez publikację strony (A6: service_site_snapshot -> site/).
-- Strona publiczna dostaje wyłącznie wpisy status = 'published' (snapshot), CRM nie ma
-- publicznego odczytu (anon bez dostępu).
--
-- Dostęp: Poseł / Administrator (is_posel) z aal2 - ten sam krąg co treść strony głównej.
-- Zmiany audytuje trigger posts_audit (bez treści - tylko slug, status, tytuł).

create table if not exists public.posts (
  id            uuid        primary key default gen_random_uuid(),
  slug          text        not null unique
    constraint posts_slug_check check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'),
  title         text        not null
    constraint posts_title_check check (char_length(btrim(title)) between 1 and 200),
  excerpt       text        not null default ''
    constraint posts_excerpt_check check (char_length(excerpt) <= 500),
  body_md       text        not null default ''
    constraint posts_body_check check (octet_length(body_md) <= 200000),
  -- Ścieżka w buckecie site-assets (blog/<plik>); pusty = brak okładki.
  cover_path    text        not null default ''
    constraint posts_cover_check check (cover_path = '' or cover_path ~ '^blog/[A-Za-z0-9._-]{1,120}$'),
  status        text        not null default 'draft'
    constraint posts_status_check check (status in ('draft', 'published', 'archived')),
  published_at  timestamptz,
  author_id     uuid        references public.profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint posts_published_check check (status <> 'published' or published_at is not null)
);

comment on table public.posts is
  'Wpisy bloga posła (Markdown). Publikowane statycznie przez service_site_snapshot (tylko status published).';

create index if not exists posts_published_idx on public.posts (published_at desc) where status = 'published';

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
before update on public.posts
for each row execute function public.set_updated_at();

-- published_at: ustawiane przy pierwszej publikacji (klient może podać datę wcześniejszą/późniejszą).
create or replace function public.posts_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
  else
    new.author_id := old.author_id;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_defaults on public.posts;
create trigger posts_defaults
before insert or update on public.posts
for each row execute function public.posts_defaults();

create or replace function public.posts_audit()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.posts := coalesce(new, old);
begin
  perform public.log_audit(
    case tg_op when 'INSERT' then 'post.create' when 'UPDATE' then 'post.update' else 'post.delete' end,
    'post',
    v_row.id,
    jsonb_build_object('slug', v_row.slug, 'status', v_row.status, 'title', left(v_row.title, 200))
      || case when tg_op = 'UPDATE' and old.status is distinct from new.status
              then jsonb_build_object('old_status', old.status) else '{}'::jsonb end
  );
  return null;
end;
$$;

drop trigger if exists posts_audit on public.posts;
create trigger posts_audit
after insert or update or delete on public.posts
for each row execute function public.posts_audit();

revoke all on function public.posts_defaults() from public, anon, authenticated;
revoke all on function public.posts_audit() from public, anon, authenticated;

alter table public.posts enable row level security;

revoke all on public.posts from public, anon, authenticated;
grant select, insert, update, delete on public.posts to authenticated;
grant all on public.posts to service_role;

drop policy if exists posts_select_posel on public.posts;
create policy posts_select_posel on public.posts for select to authenticated
  using (public.is_posel() and public.is_aal2());

drop policy if exists posts_insert_posel on public.posts;
create policy posts_insert_posel on public.posts for insert to authenticated
  with check (public.is_posel() and public.is_aal2());

drop policy if exists posts_update_posel on public.posts;
create policy posts_update_posel on public.posts for update to authenticated
  using (public.is_posel() and public.is_aal2())
  with check (public.is_posel() and public.is_aal2());

drop policy if exists posts_delete_posel on public.posts;
create policy posts_delete_posel on public.posts for delete to authenticated
  using (public.is_posel() and public.is_aal2());

-- ============================================================================
-- site-assets: zapis także do folderu blog/ (okładki i zdjęcia we wpisach)
-- ============================================================================
drop policy if exists "site_assets_insert_posel" on storage.objects;
create policy "site_assets_insert_posel"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'site-assets'
    and (storage.foldername(name))[1] in ('homepage', 'blog')
    and public.is_posel()
    and public.is_aal2()
  );

drop policy if exists "site_assets_update_posel" on storage.objects;
create policy "site_assets_update_posel"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'site-assets' and public.is_posel() and public.is_aal2())
  with check (
    bucket_id = 'site-assets'
    and (storage.foldername(name))[1] in ('homepage', 'blog')
    and public.is_posel()
    and public.is_aal2()
  );

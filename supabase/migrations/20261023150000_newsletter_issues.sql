-- ePosel - Newsletter: wydania (wersja online + archiwum do duplikowania)
--
-- Kazda wysylka testowa / docelowa z edytora zapisuje wydanie: tresc formularza (template,
-- do "Duplikuj jako nowy") i HTML wersji online (html_web). Link "Wyswietl w przegladarce"
-- w mailu prowadzi do https://<domena portalu>/n/<slug> - strone serwuje funkcja
-- Vercel api/newsletter-view.ts kluczem service_role (anon nie ma dostepu do tabeli).
--
-- slug: 16 znakow base64url z 12 losowych bajtow (96 bitow) - niezgadywalny link.
-- Cykl zycia: draft (testy, mozna nadpisywac) -> sent (po udanej wysylce, tylko odczyt).
-- Odczyt i zapis: Posel / Pracownik / Administrator (is_writer) z aal2.

create table if not exists public.newsletter_issues (
  id               uuid        primary key default gen_random_uuid(),
  slug             text        not null unique
    default translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/', '-_'),
  status           text        not null default 'draft'
    constraint newsletter_issues_status_check check (status in ('draft', 'sent')),
  subject          text        not null
    constraint newsletter_issues_subject_check check (char_length(subject) between 1 and 150),
  template         jsonb       not null,
  html_web         text        not null
    constraint newsletter_issues_html_size_check check (octet_length(html_web) <= 1048576),
  gr_newsletter_id text,
  created_by       uuid        references public.profiles(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  sent_at          timestamptz,
  constraint newsletter_issues_sent_check check ((status = 'sent') = (sent_at is not null))
);

comment on table public.newsletter_issues is
  'Wydania newslettera: tresc edytora + HTML wersji online (/n/<slug>). Zapis z edytora, publiczny odczyt tylko przez api/newsletter-view (service_role).';

create index if not exists newsletter_issues_gr_idx on public.newsletter_issues(gr_newsletter_id)
  where gr_newsletter_id is not null;
create index if not exists newsletter_issues_sent_at_idx on public.newsletter_issues(sent_at desc)
  where status = 'sent';

drop trigger if exists newsletter_issues_set_updated_at on public.newsletter_issues;
create trigger newsletter_issues_set_updated_at
before update on public.newsletter_issues
for each row execute function public.set_updated_at();

alter table public.newsletter_issues enable row level security;

revoke all on public.newsletter_issues from public, anon, authenticated;
grant select, insert, update on public.newsletter_issues to authenticated;
grant all on public.newsletter_issues to service_role;

drop policy if exists newsletter_issues_select_writer on public.newsletter_issues;
create policy newsletter_issues_select_writer
on public.newsletter_issues for select
to authenticated
using (public.is_writer() and public.is_aal2());

drop policy if exists newsletter_issues_insert_writer on public.newsletter_issues;
create policy newsletter_issues_insert_writer
on public.newsletter_issues for insert
to authenticated
with check (
  public.is_writer()
  and public.is_aal2()
  and created_by = auth.uid()
  and status = 'draft'
);

-- Wyslane wydanie jest niezmienne (using: tylko draft); draft mozna nadpisac albo oznaczyc jako wyslany.
drop policy if exists newsletter_issues_update_draft_writer on public.newsletter_issues;
create policy newsletter_issues_update_draft_writer
on public.newsletter_issues for update
to authenticated
using (public.is_writer() and public.is_aal2() and status = 'draft')
with check (public.is_writer() and public.is_aal2());

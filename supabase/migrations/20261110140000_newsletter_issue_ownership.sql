-- Newsletter: kto moze zmieniac szkic wydania + atomowa rezerwacja wysylki.
--
-- 1. can_manage_newsletters(): Posel/Administrator (is_posel) albo aktywny opiekun obszaru
--    'newsletter' (module_owners). Ten sam predykat sprawdza getresponse-proxy przed prawdziwa
--    wysylka, usuwaniem i wysylka testowa na adres innej osoby.
-- 2. newsletter_issues_update_draft_writer: szkic (temat, tresc, html_web pod /n/<slug>)
--    zmienia tylko autor (created_by) albo osoba z can_manage_newsletters(). Wczesniej mogl
--    go nadpisac kazdy writer, takze tuz przed wysylka przez Posla.
-- 3. Status 'sending': getresponse-proxy (service_role) rezerwuje szkic jednym
--    UPDATE ... WHERE status = 'draft' przed wywolaniem GetResponse, po sukcesie ustawia
--    'sent', po odrzuceniu przez GR wraca do 'draft'. Rownolegle wysylki tego samego wydania:
--    wygrywa jedna. Klient nadal nie zmienia statusu (trigger newsletter_issues_guard_publish),
--    a wiersz poza 'draft' jest dla niego niezmienny (polityka + trigger).

-- ============================================================================
-- 1. can_manage_newsletters()
-- ============================================================================
create or replace function public.can_manage_newsletters()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select public.is_posel() or exists (
    select 1
    from public.module_owners mo
    join public.profiles p on p.id = mo.user_id
    where mo.module = 'newsletter'
      and mo.user_id = auth.uid()
      and p.is_active = true
  )
$$;

comment on function public.can_manage_newsletters() is
  'Czy wywolujacy moze wysylac/usuwac newslettery i zmieniac cudze szkice wydan: is_posel() albo aktywny opiekun obszaru newsletter.';

revoke all on function public.can_manage_newsletters() from public, anon;
grant execute on function public.can_manage_newsletters() to authenticated, service_role;

-- ============================================================================
-- 2. Zmiana szkicu: autor albo zarzadzajacy newsletterem
-- ============================================================================
drop policy if exists newsletter_issues_update_draft_writer on public.newsletter_issues;
create policy newsletter_issues_update_draft_writer
on public.newsletter_issues for update
to authenticated
using (
  public.is_writer()
  and public.is_aal2()
  and status = 'draft'
  and (created_by = auth.uid() or public.can_manage_newsletters())
)
with check (
  public.is_writer()
  and public.is_aal2()
  and status = 'draft'
  and (created_by = auth.uid() or public.can_manage_newsletters())
);

-- ============================================================================
-- 3. Status 'sending' (rezerwacja wysylki przez service_role)
-- ============================================================================
alter table public.newsletter_issues drop constraint if exists newsletter_issues_status_check;
alter table public.newsletter_issues
  add constraint newsletter_issues_status_check check (status in ('draft', 'sending', 'sent'));

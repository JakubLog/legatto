-- ePosel - Faza 6.1: wymagana osoba podpisujaca/wysyajaca interpelacje
--
-- Dodajemy `interpellations.signatory_id` (FK -> profiles), wymagane (NOT NULL).
-- Backfill istniejacych rekordow wartoscia z `created_by` (autor = sygnatariusz).
-- ON DELETE RESTRICT: jesli profil ma podpisane interpelacje, nie da sie go
-- usunac trwale (admin musi najpierw przepisac sygnatariusza). Profil mozna
-- jednak deaktywowac (`is_active=false`) bez problemu.

alter table public.interpellations
  add column signatory_id uuid references public.profiles(id) on delete restrict;

-- Backfill - zakladamy ze autor istniejacych draftow byl rowniez sygnatariuszem
update public.interpellations
   set signatory_id = created_by
 where signatory_id is null
   and created_by is not null;

-- W razie sierot (created_by NULL po SET NULL od admin-delete-user) wstawiamy
-- pierwszego aktywnego Posla. Jesli zadnego Posla nie ma - kolumna zostanie
-- NULL i constraint NOT NULL nie przejdzie - reczna interwencja w DB Editor.
update public.interpellations
   set signatory_id = (
     select id from public.profiles
      where role = 'posel' and is_active = true
      order by created_at asc
      limit 1
   )
 where signatory_id is null;

alter table public.interpellations
  alter column signatory_id set not null;

create index interpellations_signatory_idx on public.interpellations(signatory_id);

-- Audit metadata: rozszerz event create o signatory (update audit_trigger)
create or replace function public.interpellation_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit(
      'interpellation.create', 'interpellation', new.id,
      jsonb_build_object('recipient', new.recipient, 'subject', new.subject, 'signatory_id', new.signatory_id)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      perform public.log_audit(
        'interpellation.status_change', 'interpellation', new.id,
        jsonb_build_object('from', old.status, 'to', new.status)
      );
    elsif old.signatory_id is distinct from new.signatory_id then
      perform public.log_audit(
        'interpellation.signatory_change', 'interpellation', new.id,
        jsonb_build_object('from', old.signatory_id, 'to', new.signatory_id)
      );
    elsif old.generated_draft is null and new.generated_draft is not null then
      perform public.log_audit(
        'interpellation.generated', 'interpellation', new.id,
        jsonb_build_object('model', new.generated_model)
      );
    else
      perform public.log_audit('interpellation.update', 'interpellation', new.id, null);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_audit(
      'interpellation.delete', 'interpellation', old.id,
      jsonb_build_object('subject', old.subject)
    );
    return old;
  end if;
  return null;
end;
$$;

-- Wymusza reload schema cache PostgREST (zeby `signatory_id` byl natychmiast
-- widoczny przez REST API bez czekania na auto-reload)
notify pgrst, 'reload schema';

-- ePosel — Fix: log_audit() blokuje INSERT przez brak SET row_security = off
--
-- Problem: kontakt_audit_trigger (oraz inne triggery) wołają log_audit(),
-- która próbuje wstawić wiersz do audit_log. Tabela audit_log ma RLS włączony
-- bez polityki INSERT. Ponieważ log_audit() jest SECURITY DEFINER ale BEZ
-- SET row_security = off, stosowane są polityki RLS wywołującego (authenticated),
-- który nie ma prawa INSERT do audit_log → wyjątek → rollback transakcji →
-- błąd przy tworzeniu kontaktu / innej encji.
--
-- Fix: dodajemy SET row_security = off do log_audit() tak jak zrobiono z
-- is_posel(), is_writer(), is_authenticated_active(), current_office_id()
-- w migracji 20260427400000_fix_recursive_rls.sql.

create or replace function public.log_audit(
  p_action text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_email text;
begin
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.audit_log (user_id, user_email, action, entity_type, entity_id, metadata)
  values (auth.uid(), v_email, p_action, p_entity_type, p_entity_id, p_metadata);
end;
$$;

grant execute on function public.log_audit(text, text, uuid, jsonb) to authenticated;

-- PoliAI: usuniecie historii rozmow po zmianie uprawnien (API-OTHER-6).
--
-- poliai_conversations.messages przechowuje pelne wyniki narzedzi (sprawy, kontakty, budzet)
-- pobrane w zakresie danych z chwili rozmowy, a summary (pamiec miedzy rozmowami, narzedzie
-- poliai_past_conversations) - ich streszczenie. Po zawezeniu scope_*, zmianie roli albo
-- dezaktywacji uzytkownik czytalby dalej dane spoza nowego zakresu (REST wlasna sesja, historia
-- w panelu, pamiec modelu). Trigger usuwa wtedy wszystkie jego rozmowy i zalaczniki:
-- - poliai_attachments: wszystkie wiersze uzytkownika (takze niewyslane, conversation_id null);
--   tekst OCR stron znika od razu. Pliki w buckecie poliai-attachments (obrazy wgrane przez
--   samego uzytkownika) bez wiersza usuwa cron poliai-purge (poliai_orphan_attachment_objects,
--   pliki starsze niz 1 dzien) przez Storage API - bezposredni DELETE na storage.objects
--   zostawilby pliki w magazynie.
-- - poliai_conversations: wszystkie rozmowy uzytkownika (z messages, summary, context_summary).
-- Kazda zmiana roli lub scope_* (takze rozszerzenie) - prosta regula bez porownywania poziomow.
-- Ponowna aktywacja niczego nie usuwa (historia zniknela przy dezaktywacji).

create or replace function public.profiles_purge_poliai_on_access_change()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_attachments integer;
  v_conversations integer;
begin
  delete from public.poliai_attachments where user_id = new.id;
  get diagnostics v_attachments = row_count;
  delete from public.poliai_conversations where user_id = new.id;
  get diagnostics v_conversations = row_count;
  if v_attachments + v_conversations > 0 then
    perform public.log_audit('poliai.history_purged', 'profile', new.id,
      jsonb_build_object(
        'conversations', v_conversations,
        'attachments', v_attachments,
        'reason', case
          when old.is_active and not new.is_active then 'deactivate'
          when old.role is distinct from new.role then 'role'
          else 'scope'
        end
      ));
  end if;
  return null;
end;
$$;

revoke all on function public.profiles_purge_poliai_on_access_change() from public, anon, authenticated;

drop trigger if exists profiles_purge_poliai_on_access_change on public.profiles;
create trigger profiles_purge_poliai_on_access_change
  after update of role, is_active, scope_contacts, scope_cases, scope_events, scope_interpellations
  on public.profiles
  for each row
  when (
    old.role is distinct from new.role
    or old.scope_contacts is distinct from new.scope_contacts
    or old.scope_cases is distinct from new.scope_cases
    or old.scope_events is distinct from new.scope_events
    or old.scope_interpellations is distinct from new.scope_interpellations
    or (old.is_active and not new.is_active)
  )
  execute function public.profiles_purge_poliai_on_access_change();

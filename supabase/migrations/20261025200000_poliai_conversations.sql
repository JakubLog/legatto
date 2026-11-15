-- PoliAI: rozmowy z asystentem AI (panel w aplikacji).
--
-- Historia rozmowy w formacie Anthropic Messages (messages) jest zrodlem prawdy po stronie
-- serwera (/api/poliai, service_role). Uzytkownik widzi i usuwa tylko wlasne rozmowy (aal2),
-- zapis wylacznie przez serwer. Pamiec miedzy rozmowami = podsumowania (summary) wlasnych
-- rozmow uzytkownika. Retencja: 90 dni od ostatniej aktywnosci (purge_expired_poliai_conversations,
-- wolane codziennie z /api/cron/poliai-purge).

create table public.poliai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text,
  messages jsonb not null default '[]'::jsonb,
  -- Dodatki tur spoza historii API: { "<indeks tury>": { intro, actions } }.
  extras jsonb not null default '{}'::jsonb,
  -- Kompresja kontekstu: model dostaje context_summary + messages[context_from:].
  context_summary text,
  context_from integer not null default 0 check (context_from >= 0),
  -- Podsumowanie dla innych rozmow (pamiec miedzy chatami).
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint poliai_conversations_title_len check (title is null or length(title) <= 120),
  constraint poliai_conversations_messages_array check (jsonb_typeof(messages) = 'array')
);

create index poliai_conversations_user_updated_idx
  on public.poliai_conversations (user_id, updated_at desc);

alter table public.poliai_conversations enable row level security;

create policy poliai_conversations_select_own
  on public.poliai_conversations for select
  to authenticated
  using (user_id = auth.uid() and public.is_aal2());

create policy poliai_conversations_delete_own
  on public.poliai_conversations for delete
  to authenticated
  using (user_id = auth.uid() and public.is_aal2());

-- Bez polityk INSERT/UPDATE: zapis tylko service_role (serwer pilnuje wlasciciela i formatu).
revoke insert, update on public.poliai_conversations from anon, authenticated;
grant select, delete on public.poliai_conversations to authenticated;

create or replace function public.purge_expired_poliai_conversations()
returns integer
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.poliai_conversations
     where updated_at < now() - interval '90 days'
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke all on function public.purge_expired_poliai_conversations() from public, anon, authenticated;
grant execute on function public.purge_expired_poliai_conversations() to service_role;

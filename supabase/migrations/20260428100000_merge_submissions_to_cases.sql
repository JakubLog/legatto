-- ePosel - Faza 7.1 (refaktor): zgłoszenia publiczne idą wprost do `cases`.
--
-- Decyzja: zamiast osobnej tabeli `public_submissions` (która wymagała własnego
-- ekranu moderacji), zgłoszenia z publicznego formularza trafiają do tabeli
-- `cases` z:
--   * source = 'public_form' (vs 'internal' dla dodanych przez pracownika)
--   * status = 'nowa' (default - wpadają do listy spraw razem z wewnętrznymi)
--   * dodatkowe pola: zgody marketingowe + metadane antyspamowe
--
-- Dotychczasowa tabela `public_submissions` (jeśli zaaplikowana) - DROPpowana.
-- Słownikowe public read policies (powiaty/gminy/case_categories.is_system)
-- ZACHOWANE - nadal potrzebne dla anonima w formularzu na stronie głównej.

-- ===== 1. DROP starej tabeli + zależności =====
drop trigger if exists public_submissions_audit on public.public_submissions;
drop trigger if exists public_submissions_validate_gmina on public.public_submissions;
drop trigger if exists public_submissions_set_triaged_at on public.public_submissions;

drop function if exists public.public_submission_audit_trigger() cascade;
drop function if exists public.validate_public_submission_gmina() cascade;
drop function if exists public.public_submissions_set_triaged_at() cascade;

drop table if exists public.public_submissions cascade;
drop type if exists public.public_submission_status cascade;

-- ===== 2. Enum source dla cases =====
create type public.case_source as enum ('internal', 'public_form');

-- ===== 3. Nowe kolumny w cases =====
alter table public.cases
  add column source public.case_source not null default 'internal',
  add column consent_newsletter boolean not null default false,
  add column consent_contacts_db boolean not null default false,
  add column submission_ip_hash text,
  add column submission_user_agent text;

-- Index dla filtrowania po źródle (ważne UI)
create index cases_source_idx on public.cases(source);
-- Index do rate limitingu w Edge Function (zliczanie po hash IP w ostatniej godzinie)
create index cases_submission_ip_recent_idx
  on public.cases(submission_ip_hash, created_at desc)
  where submission_ip_hash is not null;
-- Index dla "do dodania jako kontakty" (zgoda)
create index cases_consent_contacts_idx
  on public.cases(consent_contacts_db)
  where consent_contacts_db = true;

-- ===== 4. Audit log: oznacz zdarzenie jako z formularza =====
-- (cases_audit_trigger już loguje case.create; nie zmieniamy go - source jest w wierszu)

-- ===== 5. Podpowiedź: domyślnie source='internal' dla istniejących + nowych ręcznych =====
-- Frontend (CaseFormDialog) wstawia bez source, default zadba o 'internal'.
-- Edge Function (public-submit-case) explicite ustawia source='public_form'.

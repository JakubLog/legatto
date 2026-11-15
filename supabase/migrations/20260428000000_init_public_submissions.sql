-- ePosel - Faza 7: publiczne zgłoszenia spraw (formularz na stronie głównej)
--
-- Anonimowi użytkownicy zgłaszają sprawy przez formularz publiczny.
-- Edge Function `public-submit-case` weryfikuje Cloudflare Turnstile + rate limit
-- i wstawia rekord przez service_role (anon nie ma INSERT policy).
-- Pracownik biura triażuje zgłoszenia w portalu (osobny ekran w Fazie 7.2).

-- ===== ENUM =====
create type public.public_submission_status as enum
  ('incoming', 'triaged', 'linked_to_case', 'dismissed');

-- ===== TABELA =====
create table public.public_submissions (
  id uuid primary key default gen_random_uuid(),

  -- Dane reportera (publiczne, niezweryfikowane)
  reporter_name text not null,
  reporter_email text,
  reporter_phone text,

  -- Lokalizacja i kategoria
  powiat_id smallint not null references public.powiaty(id) on delete restrict,
  gmina_id integer references public.gminy(id) on delete set null,
  category_id integer not null references public.case_categories(id) on delete restrict,

  -- Treść zgłoszenia
  title text not null,
  description text not null,

  -- Zgoda RODO (musi być true - constraint)
  rodo_consent boolean not null,

  -- Metadane antyspam (raw IP NIE trafia do bazy - tylko hash z saltem)
  submission_ip_hash text not null,
  user_agent text,

  -- Triage (wypełniane przez pracownika biura)
  status public.public_submission_status not null default 'incoming',
  triage_notes text,
  triaged_by uuid references public.profiles(id) on delete set null,
  triaged_at timestamptz,
  linked_case_id uuid references public.cases(id) on delete set null,

  -- Timestamps
  submitted_at timestamptz not null default now(),

  -- Constrainty walidacyjne
  constraint contact_required check (reporter_email is not null or reporter_phone is not null),
  constraint rodo_required check (rodo_consent = true),
  constraint title_min_length check (char_length(title) >= 5),
  constraint title_max_length check (char_length(title) <= 200),
  constraint description_min_length check (char_length(description) >= 20),
  constraint description_max_length check (char_length(description) <= 5000),
  constraint name_min_length check (char_length(reporter_name) >= 3),
  constraint name_max_length check (char_length(reporter_name) <= 100)
);

-- ===== INDEKSY =====
create index public_submissions_status_idx on public.public_submissions(status);
create index public_submissions_submitted_idx on public.public_submissions(submitted_at desc);
create index public_submissions_powiat_idx on public.public_submissions(powiat_id);
create index public_submissions_category_idx on public.public_submissions(category_id);
-- Do rate limitingu po IP (composite z timestampem)
create index public_submissions_ip_recent_idx
  on public.public_submissions(submission_ip_hash, submitted_at desc);
-- Pełnotekstowe wyszukiwanie tytułu/opisu
create index public_submissions_search_idx on public.public_submissions using gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
);

-- ===== TRIGGER: auto-fill triaged_at gdy status zmienia się z 'incoming' =====
create or replace function public.public_submissions_set_triaged_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    -- gdy status przechodzi z 'incoming' do innego, ustaw triaged_at + triaged_by
    if old.status = 'incoming' and new.status <> 'incoming' then
      new.triaged_at = coalesce(new.triaged_at, now());
      new.triaged_by = coalesce(new.triaged_by, auth.uid());
    end if;
    -- gdy status wraca do 'incoming', wyczyść (rzadkie, ale możliwe przy cofaniu triażu)
    if old.status <> 'incoming' and new.status = 'incoming' then
      new.triaged_at = null;
      new.triaged_by = null;
      new.linked_case_id = null;
    end if;
  end if;
  return new;
end;
$$;

create trigger public_submissions_set_triaged_at
before update on public.public_submissions
for each row execute function public.public_submissions_set_triaged_at();

-- ===== TRIGGER: walidacja gminy względem powiatu =====
create or replace function public.validate_public_submission_gmina()
returns trigger
language plpgsql
as $$
begin
  if new.gmina_id is not null and not exists (
    select 1 from public.gminy where id = new.gmina_id and powiat_id = new.powiat_id
  ) then
    raise exception 'Gmina % nie należy do powiatu %', new.gmina_id, new.powiat_id;
  end if;
  return new;
end;
$$;

create trigger public_submissions_validate_gmina
before insert or update on public.public_submissions
for each row execute function public.validate_public_submission_gmina();

-- ===== TRIGGER: audit log =====
create or replace function public.public_submission_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit(
      'public_submission.create', 'public_submission', new.id,
      jsonb_build_object(
        'title', new.title,
        'category_id', new.category_id,
        'powiat_id', new.powiat_id
      )
    );
    return new;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      perform public.log_audit(
        'public_submission.status_change', 'public_submission', new.id,
        jsonb_build_object('from', old.status, 'to', new.status, 'title', new.title)
      );
    else
      perform public.log_audit(
        'public_submission.update', 'public_submission', new.id,
        jsonb_build_object('title', new.title)
      );
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_audit(
      'public_submission.delete', 'public_submission', old.id,
      jsonb_build_object('title', old.title)
    );
    return old;
  end if;
  return null;
end;
$$;

create trigger public_submissions_audit
after insert or update or delete on public.public_submissions
for each row execute function public.public_submission_audit_trigger();

-- ===== RLS =====
alter table public.public_submissions enable row level security;

-- SELECT: każdy aktywny user (poseł / pracownik / asystent)
create policy public_submissions_select_authenticated
on public.public_submissions for select
to authenticated
using (public.is_authenticated_active());

-- UPDATE: writer (poseł + pracownik); asystent NIE może triażować
create policy public_submissions_update_writer
on public.public_submissions for update
to authenticated
using (public.is_writer())
with check (public.is_writer());

-- DELETE: tylko poseł
create policy public_submissions_delete_posel
on public.public_submissions for delete
to authenticated
using (public.is_posel());

-- INSERT: brak policy dla anon i authenticated.
-- Jedyna ścieżka INSERT to Edge Function `public-submit-case` przez service_role
-- (service_role omija RLS).

-- ===== PUBLIC READ DLA SŁOWNIKÓW (potrzebne formularzowi anon) =====

-- Powiaty - pełna lista 12 powiatów dostępna dla anonima
create policy powiaty_public_read
on public.powiaty for select
to anon
using (true);

-- Gminy - pełna lista 61 gmin dostępna dla anonima
create policy gminy_public_read
on public.gminy for select
to anon
using (true);

-- Kategorie systemowe (10 wpisów) - dla anonima; user-added kategorie pozostają chronione
create policy case_categories_public_read_system
on public.case_categories for select
to anon
using (is_system = true);

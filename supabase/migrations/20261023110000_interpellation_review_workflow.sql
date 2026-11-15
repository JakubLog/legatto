-- ePosel - nowy obieg interpelacji: MCP Pracownika -> decyzja Posla -> wysylka
--
-- Pelny cutover ze starego edytora/generatora AI. Interpelacje nowe i po poprawkach
-- trafiaja tylko przez MCP (service_role); aplikacja obsluguje decyzje i wysylke.

-- Zatrzymaj stare automaty statusu `sent` przed zmiana enum.
drop trigger if exists interpellations_set_sent_at on public.interpellations;
drop function if exists public.interpellations_set_sent_at();

-- Nowa tresc i metadane obiegu.
alter table public.interpellations
  add column content_html text,
  add column content_text text,
  add column review_notes text,
  add column revision integer not null default 1,
  add column submitted_at timestamptz,
  add column decided_at timestamptz,
  add column decided_by uuid references public.profiles(id) on delete set null,
  add column accepted_at timestamptz,
  add column deadline_at timestamptz,
  add column archived_at timestamptz;

-- Zachowaj tresc starych rekordow. HTML jest bezpiecznym <pre> z escaped tekstem.
-- sent_at: zachowaj dla starych wyslanych, wyczysc dla rekordow przenoszonych do "Nowa".
-- Musi byc w tym samym UPDATE przed zmiana enum: trigger interpellations_audit (plpgsql)
-- cache'uje typ statusu, a drugi UPDATE po DROP TYPE konczy sie "cache lookup failed for type".
update public.interpellations
set content_text = coalesce(final_text, generated_draft, problem_description, ''),
    content_html = '<pre style="white-space:pre-wrap;font-family:system-ui,sans-serif">' ||
      replace(
        replace(
          replace(coalesce(final_text, generated_draft, problem_description, ''), '&', '&amp;'),
          '<', '&lt;'
        ),
        '>', '&gt;'
      ) || '</pre>',
    submitted_at = created_at,
    sent_at = case when status = 'sent' then coalesce(sent_at, updated_at) else null end;

alter table public.interpellations
  alter column content_html set not null,
  alter column content_text set not null,
  alter column submitted_at set not null,
  alter column submitted_at set default now(),
  add constraint interpellations_revision_positive check (revision >= 1),
  add constraint interpellations_content_html_size check (length(content_html) <= 600000),
  add constraint interpellations_content_text_size check (length(content_text) <= 300000),
  add constraint interpellations_review_notes_size check (length(review_notes) <= 5000);

-- Nowy enum. Stare wyslane pozostaja wyslane; pozostale trafiaja do kolejki "Nowa".
create type public.interpellation_status_new as enum (
  'nowa',
  'uwagi',
  'po_poprawkach',
  'zaakceptowana',
  'wyslana',
  'odrzucona'
);

alter table public.interpellations alter column status drop default;
alter table public.interpellations
  alter column status type public.interpellation_status_new
  using (
    case when status::text = 'sent' then 'wyslana' else 'nowa' end
  )::public.interpellation_status_new;

drop type public.interpellation_status;
alter type public.interpellation_status_new rename to interpellation_status;
alter table public.interpellations alter column status set default 'nowa';

-- Stare pola generatora nie należą już do modelu.
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
      jsonb_build_object(
        'recipient', new.recipient,
        'subject', new.subject,
        'signatory_id', new.signatory_id,
        'revision', new.revision
      )
    );
    return new;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      perform public.log_audit(
        'interpellation.status_change', 'interpellation', new.id,
        jsonb_strip_nulls(jsonb_build_object(
          'from', old.status,
          'to', new.status,
          'revision', new.revision,
          'review_notes', new.review_notes
        ))
      );
    elsif old.signatory_id is distinct from new.signatory_id then
      perform public.log_audit(
        'interpellation.signatory_change', 'interpellation', new.id,
        jsonb_build_object('from', old.signatory_id, 'to', new.signatory_id)
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

drop index if exists public.interpellations_search_idx;
create index interpellations_search_idx on public.interpellations using gin (
  to_tsvector(
    'simple',
    coalesce(subject, '') || ' ' || coalesce(recipient, '') || ' ' || coalesce(content_text, '')
  )
);
create index interpellations_deadline_idx on public.interpellations(deadline_at)
  where status = 'zaakceptowana';
create index interpellations_submitted_idx on public.interpellations(submitted_at desc);

alter table public.interpellations
  drop column problem_description,
  drop column generated_draft,
  drop column final_text,
  drop column generated_at,
  drop column generated_model;

-- Jedno miejsce egzekwuje przejscia i znaczniki czasu dla aplikacji oraz MCP.
create or replace function public.interpellations_enforce_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_decider uuid;
begin
  if tg_op = 'INSERT' then
    new.status := 'nowa';
    new.revision := 1;
    new.submitted_at := coalesce(new.submitted_at, now());
    new.review_notes := null;
    new.decided_at := null;
    new.decided_by := null;
    new.accepted_at := null;
    new.deadline_at := null;
    new.sent_at := null;
    new.archived_at := null;
    return new;
  end if;

  -- Tresc zmienia wylacznie ponowne wgranie przez MCP.
  if new.content_html is distinct from old.content_html
     or new.content_text is distinct from old.content_text
     or new.recipient is distinct from old.recipient
     or new.subject is distinct from old.subject then
    if old.status <> 'uwagi' or new.status <> 'po_poprawkach' or v_actor is not null then
      raise exception 'Tresc interpelacji mozna zmienic tylko przez MCP na etapie Uwagi'
        using errcode = '42501';
    end if;
  end if;

  if new.status is not distinct from old.status then
    if new.review_notes is distinct from old.review_notes
       or new.revision is distinct from old.revision
       or new.submitted_at is distinct from old.submitted_at
       or new.decided_at is distinct from old.decided_at
       or new.decided_by is distinct from old.decided_by
       or new.accepted_at is distinct from old.accepted_at
       or new.deadline_at is distinct from old.deadline_at
       or new.sent_at is distinct from old.sent_at
       or new.archived_at is distinct from old.archived_at then
      raise exception 'Pola obiegu interpelacji zmieniaja sie tylko razem ze statusem'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Poseł lub Administrator podejmuje decyzje nad nowa wersja.
  if old.status in ('nowa', 'po_poprawkach')
     and new.status in ('zaakceptowana', 'uwagi', 'odrzucona') then
    if v_actor is not null and not public.is_posel() then
      raise exception 'Tylko Posel lub Administrator moze podjac decyzje'
        using errcode = '42501';
    end if;

    v_decider := coalesce(v_actor, new.decided_by);
    if v_decider is null or not exists (
      select 1 from public.profiles
      where id = v_decider and role in ('posel', 'administrator') and is_active = true
    ) then
      raise exception 'Decyzja wymaga aktywnego Posla lub Administratora'
        using errcode = '42501';
    end if;
    if new.status = 'uwagi' and nullif(trim(coalesce(new.review_notes, '')), '') is null then
      raise exception 'Uwagi Posla sa wymagane przy decyzji Uwagi'
        using errcode = '22023';
    end if;

    new.decided_at := now();
    new.decided_by := v_decider;
    new.accepted_at := null;
    new.deadline_at := null;
    new.sent_at := null;
    new.archived_at := null;

    if new.status = 'zaakceptowana' then
      new.accepted_at := now();
      new.deadline_at := new.accepted_at + interval '1 day';
    elsif new.status = 'odrzucona' then
      new.archived_at := now();
    end if;
    return new;
  end if;

  -- Pracownik wgrywa poprawiona wersje wylacznie przez MCP (service_role).
  if old.status = 'uwagi' and new.status = 'po_poprawkach' then
    if v_actor is not null then
      raise exception 'Poprawki interpelacji nalezy wgrac przez MCP'
        using errcode = '42501';
    end if;
    if new.content_html is not distinct from old.content_html then
      raise exception 'Poprawiona wersja musi zawierac zmieniony HTML'
        using errcode = '22023';
    end if;

    new.revision := old.revision + 1;
    new.submitted_at := now();
    new.accepted_at := null;
    new.deadline_at := null;
    new.sent_at := null;
    new.archived_at := null;
    return new;
  end if;

  -- Po akceptacji Poseł lub Pracownik potwierdza faktyczna wysylke.
  if old.status = 'zaakceptowana' and new.status = 'wyslana' then
    if v_actor is not null and not public.is_writer() then
      raise exception 'Tylko Posel, Administrator lub Pracownik moze oznaczyc wysylke'
        using errcode = '42501';
    end if;
    new.sent_at := now();
    return new;
  end if;

  raise exception 'Niedozwolone przejscie statusu interpelacji: % -> %', old.status, new.status
    using errcode = '22023';
end;
$$;

drop trigger if exists interpellations_workflow on public.interpellations;
create trigger interpellations_workflow
before insert or update on public.interpellations
for each row execute function public.interpellations_enforce_workflow();

revoke all on function public.interpellations_enforce_workflow() from public, anon, authenticated;
revoke all on function public.interpellation_audit_trigger() from public, anon, authenticated;

-- Nowe rekordy powstaja tylko przez MCP. RLS nadal pozwala aplikacji podejmowac
-- decyzje i potwierdzac wysylke; trigger powyzej egzekwuje role oraz przejscia.
drop policy if exists interpellations_insert_writer on public.interpellations;
create policy interpellations_insert_mcp_only
on public.interpellations for insert
to authenticated
with check (false);

-- Informacyjny zakres tokena odpowiada nowym narzedziom zapisu Pracownika.
create or replace function public.create_mcp_token(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role;
  v_token text;
  v_random text;
  v_hash text;
  v_prefix text;
  v_scopes text[];
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    raise exception 'Wymagana sesja z 2FA (aal2)' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_user_id and is_active = true;
  if v_role in ('posel'::public.app_role, 'administrator'::public.app_role) then
    v_scopes := array['cases','contacts','events','interpellations','budget','audit'];
  elsif v_role = 'pracownik'::public.app_role then
    v_scopes := array['cases','contacts','events','interpellations','budget_read'];
  else
    raise exception 'Brak uprawnien (wymagana rola: posel, administrator lub pracownik)'
      using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Nazwa tokena jest wymagana' using errcode = '22023';
  end if;
  if length(p_name) > 60 then
    raise exception 'Nazwa tokena nie moze przekraczac 60 znakow' using errcode = '22023';
  end if;

  v_random := translate(rtrim(encode(extensions.gen_random_bytes(36), 'base64'), '='), '+/', '-_');
  v_token := 'epm_' || v_random;
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_prefix := substr(v_random, 1, 12);

  insert into public.mcp_tokens(user_id, name, token_hash, token_prefix, scopes)
  values (v_user_id, trim(p_name), v_hash, v_prefix, v_scopes);
  perform public.log_audit(
    'mcp_token.create', 'mcp_token', null,
    jsonb_build_object('name', trim(p_name), 'prefix', v_prefix, 'role', v_role)
  );
  return v_token;
end;
$$;

revoke all on function public.create_mcp_token(text) from public, anon;
grant execute on function public.create_mcp_token(text) to authenticated;

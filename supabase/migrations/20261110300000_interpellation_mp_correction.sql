-- Posel lub Administrator moze sam poprawic tresc interpelacji (HTML, temat, odbiorca)
-- i od razu ja zaakceptowac - przez MCP (interpellations_decide z html/subject/recipient).
-- Poprawka zwieksza numer wersji. Aplikacja (auth.uid() ustawione) nadal nie zmienia tresci.

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
  v_content_changed boolean;
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

  -- Tresc zmienia wylacznie MCP (service_role, bez auth.uid()): Pracownik ponownym wgraniem
  -- na etapie Uwagi albo Posel/Administrator poprawka przy akceptacji wersji czekajacej na decyzje.
  v_content_changed := new.content_html is distinct from old.content_html
     or new.content_text is distinct from old.content_text
     or new.recipient is distinct from old.recipient
     or new.subject is distinct from old.subject;
  if v_content_changed then
    if v_actor is not null
       or not (
         (old.status = 'uwagi' and new.status = 'po_poprawkach')
         or (old.status in ('nowa', 'po_poprawkach') and new.status = 'zaakceptowana')
       ) then
      raise exception 'Tresc interpelacji zmienia tylko MCP: Pracownik na etapie Uwagi albo Posel przy akceptacji'
        using errcode = '42501';
    end if;
  end if;

  -- Pracownik nie moze przez REST przepinac sprawy ani osoby podpisujacej.
  -- Posel/Administrator zachowuje mozliwosc administracyjnego przepisania rekordu.
  if new.case_id is distinct from old.case_id
     or new.signatory_id is distinct from old.signatory_id then
    if v_actor is not null and not public.is_posel() then
      raise exception 'Tylko Posel lub Administrator moze zmienic sprawe albo sygnatariusza'
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
    -- Poprawka Posla przy akceptacji to nowa wersja tresci.
    new.revision := old.revision + case when v_content_changed then 1 else 0 end;

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
    if old.decided_at is not null then
      insert into public.interpellation_duration_samples (
        interpellation_id, metric, revision, duration_seconds, completed_at
      ) values (
        old.id,
        'feedback_to_revision',
        new.revision,
        greatest(
          0::bigint,
          floor(extract(epoch from (new.submitted_at - old.decided_at)))::bigint
        ),
        new.submitted_at
      ) on conflict (interpellation_id, metric, revision) do nothing;
    end if;
    return new;
  end if;

  -- Po akceptacji Poseł lub Pracownik potwierdza faktyczna wysylke.
  if old.status = 'zaakceptowana' and new.status = 'wyslana' then
    if v_actor is not null and not public.is_writer() then
      raise exception 'Tylko Posel, Administrator lub Pracownik moze oznaczyc wysylke'
        using errcode = '42501';
    end if;
    new.sent_at := now();
    insert into public.interpellation_duration_samples (
      interpellation_id, metric, revision, duration_seconds, completed_at
    ) values (
      old.id,
      'submission_to_sent',
      old.revision,
      greatest(0::bigint, floor(extract(epoch from (new.sent_at - old.created_at)))::bigint),
      new.sent_at
    ) on conflict (interpellation_id, metric, revision) do nothing;
    if old.accepted_at is not null then
      insert into public.interpellation_duration_samples (
        interpellation_id, metric, revision, duration_seconds, completed_at
      ) values (
        old.id,
        'acceptance_to_sent',
        old.revision,
        greatest(
          0::bigint,
          floor(extract(epoch from (new.sent_at - old.accepted_at)))::bigint
        ),
        new.sent_at
      ) on conflict (interpellation_id, metric, revision) do nothing;
    end if;
    return new;
  end if;

  raise exception 'Niedozwolone przejscie statusu interpelacji: % -> %', old.status, new.status
    using errcode = '22023';
end;
$$;

revoke all on function public.interpellations_enforce_workflow() from public, anon, authenticated;

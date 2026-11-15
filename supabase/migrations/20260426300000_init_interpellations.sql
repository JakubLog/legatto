-- ePosel - Faza 6: interpelacje (AI generowanie + PDF)

create type public.interpellation_status as enum ('draft', 'generated', 'edited', 'sent');

create table public.interpellations (
  id uuid primary key default gen_random_uuid(),
  recipient text not null,
  subject text not null,
  problem_description text not null,
  generated_draft text,
  final_text text,
  case_id uuid references public.cases(id) on delete set null,
  status public.interpellation_status not null default 'draft',
  generated_at timestamptz,
  generated_model text,
  sent_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index interpellations_status_idx on public.interpellations(status);
create index interpellations_case_idx on public.interpellations(case_id) where case_id is not null;
create index interpellations_created_idx on public.interpellations(created_at desc);
create index interpellations_search_idx on public.interpellations using gin (
  to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(recipient, ''))
);

create trigger interpellations_set_updated_at
before update on public.interpellations
for each row execute function public.set_updated_at();

create trigger interpellations_set_created_by
before insert on public.interpellations
for each row execute function public.set_created_by();

-- Auto sent_at gdy status -> sent
create or replace function public.interpellations_set_sent_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' and new.status = 'sent' then
    new.sent_at = coalesce(new.sent_at, now());
  end if;
  if tg_op = 'UPDATE' then
    if old.status <> 'sent' and new.status = 'sent' then
      new.sent_at = coalesce(new.sent_at, now());
    elsif old.status = 'sent' and new.status <> 'sent' then
      new.sent_at = null;
    end if;
  end if;
  return new;
end;
$$;

create trigger interpellations_set_sent_at
before insert or update on public.interpellations
for each row execute function public.interpellations_set_sent_at();

-- Audit
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
      jsonb_build_object('recipient', new.recipient, 'subject', new.subject)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      perform public.log_audit(
        'interpellation.status_change', 'interpellation', new.id,
        jsonb_build_object('from', old.status, 'to', new.status)
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

create trigger interpellations_audit
after insert or update or delete on public.interpellations
for each row execute function public.interpellation_audit_trigger();

-- RLS
alter table public.interpellations enable row level security;

create policy interpellations_select_authenticated
on public.interpellations for select
to authenticated
using (public.is_authenticated_active());

create policy interpellations_insert_writer
on public.interpellations for insert
to authenticated
with check (public.is_writer());

create policy interpellations_update_writer
on public.interpellations for update
to authenticated
using (public.is_writer())
with check (public.is_writer());

create policy interpellations_delete_posel
on public.interpellations for delete
to authenticated
using (public.is_posel());

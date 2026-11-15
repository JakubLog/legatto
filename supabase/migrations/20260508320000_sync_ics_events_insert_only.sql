-- Zmiana sync_ics_events: ON CONFLICT DO NOTHING
-- Importujemy tylko brakujące wydarzenia (filtr zakresu w Vercel Function).
-- Istniejące (po ics_uid + ics_source_id) są pomijane bez nadpisywania.

create or replace function public.sync_ics_events(
  p_source_id uuid,
  p_user_id   uuid,
  p_events    jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_event      jsonb;
  v_count      integer := 0;
  v_inserted   integer;
  v_starts_at  timestamptz;
  v_ends_at    timestamptz;
begin
  if not exists (select 1 from public.ics_sources where id = p_source_id) then
    raise exception 'ICS source % not found', p_source_id;
  end if;

  for v_event in select * from jsonb_array_elements(p_events)
  loop
    v_starts_at := (v_event->>'starts_at')::timestamptz;
    v_ends_at   := nullif(v_event->>'ends_at', '')::timestamptz;

    if v_ends_at is not null and v_ends_at <= v_starts_at then
      v_ends_at := null;
    end if;

    insert into public.events (
      title, description, type, starts_at, ends_at, all_day,
      location, is_public, ics_uid, ics_source_id, created_by
    ) values (
      v_event->>'title',
      nullif(v_event->>'description', ''),
      'inne'::public.event_type,
      v_starts_at,
      v_ends_at,
      coalesce((v_event->>'all_day')::boolean, false),
      nullif(v_event->>'location', ''),
      false,
      v_event->>'uid',
      p_source_id,
      p_user_id
    )
    on conflict (ics_uid, ics_source_id)
    where ics_uid is not null and ics_source_id is not null
    do nothing;

    get diagnostics v_inserted = row_count;
    v_count := v_count + v_inserted;
  end loop;

  update public.ics_sources set
    last_synced_at     = now(),
    synced_event_count = v_count
  where id = p_source_id;

  return v_count;
end;
$$;

revoke execute on function public.sync_ics_events(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant  execute on function public.sync_ics_events(uuid, uuid, jsonb)
  to service_role;

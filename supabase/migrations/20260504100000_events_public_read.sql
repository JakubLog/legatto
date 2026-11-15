-- Publiczny wglad do kalendarza wydarzen na stronie glownej.
-- Eksponujemy WYLACZNIE wydarzenia oznaczone is_public=true, przez SECURITY DEFINER funkcje
-- (zwraca tylko bezpieczne kolumny + nazwe powiatu/gminy; bez case_id/contact_id/assigned_to).

alter table public.events
  add column if not exists is_public boolean not null default false;

comment on column public.events.is_public is
  'Czy wydarzenie ma byc widoczne w sekcji "Najblizsze wydarzenia" na publicznej stronie glownej.';

create index if not exists events_public_starts_at_idx
  on public.events (starts_at)
  where is_public = true;

create or replace function public.get_public_upcoming_events(p_limit int default 6)
returns table (
  id uuid,
  title text,
  description text,
  type public.event_type,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  location text,
  powiat_name text,
  gmina_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.title,
    e.description,
    e.type,
    e.starts_at,
    e.ends_at,
    e.all_day,
    e.location,
    pw.name as powiat_name,
    gm.name as gmina_name
  from public.events e
  left join public.powiaty pw on pw.id = e.powiat_id
  left join public.gminy   gm on gm.id = e.gmina_id
  where e.is_public = true
    and e.starts_at >= now() - interval '6 hours'
  order by e.starts_at asc
  limit greatest(1, least(coalesce(p_limit, 6), 24))
$$;

grant execute on function public.get_public_upcoming_events(int) to anon, authenticated;

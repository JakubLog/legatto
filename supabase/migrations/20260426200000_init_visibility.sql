-- ePosel - Faza 5: widoczność w terenie (app_settings + view powiat_visibility_stats)

-- ===== APP_SETTINGS (klucz/wartość) =====
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Seed: prog dni od ostatniego wydarzenia, po którym powiat jest "czerwony"
insert into public.app_settings (key, value) values
  ('visibility_alert_days', '90'::jsonb);

-- Trigger: ustaw updated_at + updated_by przy update
create or replace function public.app_settings_set_meta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

create trigger app_settings_meta
before update on public.app_settings
for each row execute function public.app_settings_set_meta();

-- RLS
alter table public.app_settings enable row level security;

create policy app_settings_select_authenticated
on public.app_settings for select
to authenticated
using (public.is_authenticated_active());

-- INSERT/UPDATE: Poseł
create policy app_settings_insert_posel
on public.app_settings for insert
to authenticated
with check (public.is_posel());

create policy app_settings_update_posel
on public.app_settings for update
to authenticated
using (public.is_posel())
with check (public.is_posel());

-- ===== VIEW: visibility per powiat =====
create or replace view public.powiat_visibility_stats
with (security_invoker = true)
as
select
  p.id              as powiat_id,
  p.name            as powiat_name,
  p.is_city,
  p.lat,
  p.lng,
  coalesce(c_stats.contacts_count, 0)::int as contacts_count,
  coalesce(e_stats.events_count, 0)::int   as events_count,
  e_stats.last_event_at,
  case
    when e_stats.last_event_at is null then null
    else extract(day from (now() - e_stats.last_event_at))::int
  end as days_since_last_event
from public.powiaty p
left join lateral (
  select count(*) as contacts_count
  from public.contacts c
  where c.powiat_id = p.id
) c_stats on true
left join lateral (
  select
    count(*) as events_count,
    max(e.starts_at) as last_event_at
  from public.events e
  where e.powiat_id = p.id
    and e.type in ('spotkanie', 'wyjazd')
    and e.starts_at <= now()
) e_stats on true;

comment on view public.powiat_visibility_stats is
  'Statystyki widoczności per powiat: liczba kontaktów + liczba spotkań/wyjazdów + ostatnia obecność + dni od.';

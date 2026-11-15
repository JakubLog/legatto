-- ePosel - poprawki bezpieczenstwa, trzecie przejscie (2026-11-07).
--
-- 1. get_public_district() (R2-04): anon dostaje tylko pola uzywane przez mape okregu
--    (src/hooks/useDistrict.ts), z kontrola typow i limitem dlugosci etykiety - nie caly
--    JSON z app_settings 'district'. Brak klucza = '{}' (bez zmian dla frontendu).
-- 2. poliai_claim_daily_slot() (L2): dzienny limit zadan PoliAI atomowo. Dotad
--    api/_lib/poliai/session.ts liczyl audit_log i osobno wstawial wpis, wiec N rownoleglych
--    zadan przy licznik = limit-1 przechodzilo naraz. Teraz blokada doradcza per uzytkownik
--    i akcja, licznik z 24 h i wpis audytu w jednej transakcji: wpis audytu jest zajetym slotem.
-- 3. Sieroty w magazynie (STOR-02): case_attachments_orphan_objects() i
--    avatars_orphan_objects() - pliki starsze niz 1 dzien bez wiersza w bazie. Usuwa je cron
--    /api/cron/poliai-purge przez Storage API (jak receipts_orphan_objects z 20261107910000).

-- ============================================================================
-- 1. get_public_district - tylko pola mapy
-- ============================================================================
create or replace function public.get_public_district()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_build_object(
      'number',
        case when jsonb_typeof(s.value -> 'number') = 'number' then s.value -> 'number' end,
      'highlighted_powiat_id',
        case when jsonb_typeof(s.value -> 'highlighted_powiat_id') = 'number' then s.value -> 'highlighted_powiat_id' end,
      'highlighted_gmina_id',
        case when jsonb_typeof(s.value -> 'highlighted_gmina_id') = 'number' then s.value -> 'highlighted_gmina_id' end,
      'highlight_label',
        case when jsonb_typeof(s.value -> 'highlight_label') = 'string' then to_jsonb(left(s.value ->> 'highlight_label', 80)) end
    )
    from public.app_settings s
    where s.key = 'district'
      and jsonb_typeof(s.value) = 'object'
  ), '{}'::jsonb)
$$;

revoke all on function public.get_public_district() from public;
grant execute on function public.get_public_district() to anon, authenticated;

-- ============================================================================
-- 2. poliai_claim_daily_slot - atomowy dzienny limit PoliAI (service_role)
-- ============================================================================
-- true = slot zajety (wpis audytu p_action zapisany), false = limit z ostatnich 24 h wyczerpany.
-- Blokada transakcyjna szereguje rownolegle zadania tego samego uzytkownika i akcji; licznik
-- (osobna instrukcja w READ COMMITTED) widzi juz wpisy zatwierdzone przez poprzednika.
create or replace function public.poliai_claim_daily_slot(
  p_user_id uuid,
  p_action text,
  p_limit integer,
  p_metadata jsonb default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
set row_security = off
as $$
declare
  v_used integer;
begin
  if p_user_id is null then
    raise exception 'p_user_id wymagane' using errcode = '22023';
  end if;
  if p_action is null or length(p_action) = 0 then
    raise exception 'p_action wymagane' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 0 then
    raise exception 'p_limit wymagane (>= 0)' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('poliai_claim_daily_slot:' || p_user_id::text || ':' || p_action, 0)
  );

  select count(*) into v_used
    from public.audit_log a
   where a.user_id = p_user_id
     and a.action = p_action
     and a.created_at >= now() - interval '24 hours';

  if v_used >= p_limit then
    return false;
  end if;

  perform public.mcp_log_audit(p_user_id, p_action, null, null, p_metadata);
  return true;
end;
$$;

revoke all on function public.poliai_claim_daily_slot(uuid, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.poliai_claim_daily_slot(uuid, text, integer, jsonb) to service_role;

-- ============================================================================
-- 3. Sieroty w bucketach case-attachments i avatars (service_role)
-- ============================================================================
-- case-attachments: usuniecie sprawy kasuje wiersze (on delete cascade), ale nie pliki;
-- nieudany insert wiersza po uploadzie zostawia plik (pracownik nie ma DELETE w buckecie).
create or replace function public.case_attachments_orphan_objects(max_rows integer)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'case-attachments'
     and o.created_at < now() - interval '1 day'
     and not exists (select 1 from public.case_attachments ca where ca.storage_path = o.name)
   order by o.created_at
   limit greatest(coalesce(max_rows, 0), 0);
$$;

revoke all on function public.case_attachments_orphan_objects(integer) from public, anon, authenticated;
grant execute on function public.case_attachments_orphan_objects(integer) to service_role;

-- avatars: kazdy upload to nowy plik ({uid}/{timestamp}.{ext}); podmiana lub usuniecie
-- zdjecia i usuniecie konta zostawiaja stare pliki dostepne pod publicznym URL.
-- profiles.avatar_url = publiczny URL .../storage/v1/object/public/avatars/<nazwa obiektu>
-- (profiles_avatar_url_storage_check z 20261107200000, bez query stringa).
create or replace function public.avatars_orphan_objects(max_rows integer)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'avatars'
     and o.created_at < now() - interval '1 day'
     and not exists (
       select 1
         from public.profiles p
        where p.avatar_url is not null
          and split_part(p.avatar_url, '/storage/v1/object/public/avatars/', 2) = o.name
     )
   order by o.created_at
   limit greatest(coalesce(max_rows, 0), 0);
$$;

revoke all on function public.avatars_orphan_objects(integer) from public, anon, authenticated;
grant execute on function public.avatars_orphan_objects(integer) to service_role;

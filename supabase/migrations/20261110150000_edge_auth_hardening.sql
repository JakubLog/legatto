-- Przeglad bezpieczenstwa 2026-11-10 (Edge Functions / konta):
--
-- 1. EDGE-6: konto Posla (rola 'posel') nadaje, odbiera, aktywuje i dezaktywuje tylko Posel.
--    Administrator ma w biurze rowne prawa, ale nie moze zastapic ani odciac wlasciciela
--    instancji (nowe konto 'posel' + usuniecie prawdziwego). Trigger obejmuje teraz takze
--    INSERT (polityka profiles_insert_posel). Wywolania przez service_role (Edge Functions,
--    auth.uid() = null) sprawdzaja to w kodzie funkcji przed zapisem.
-- 2. Ochrona ostatniego Posla liczy tylko prawdziwe konta: aktywny profil 'posel'
--    z ustawionym haslem (password_set) i zweryfikowanym faktorem 2FA. Swieze, nieprzyjete
--    zaproszenie Posla nie pozwala usunac ani zdegradowac konta, ktore faktycznie dziala.
--    service_other_real_posel_exists() - ta sama regula dla pre-checku w admin-delete-user.
-- 3. EDGE-7: service_audit_claim_cooldown() - wpis audytu z cooldownem atomowo (advisory
--    lock per encja): admin-send-auth-link zapisuje wpis PRZED wysylka maila, wiec
--    rownolegle wywolania nie omijaja limitu 5 min.
--
-- Limit globalny formularza publicznego (EDGE-3) korzysta z istniejacego
-- claim_public_submission_slot() ze stalym kluczem - bez zmian w bazie.

-- ============================================================================
-- 1. Prawdziwe konto Posla (do ochrony ostatniego Posla)
-- ============================================================================
create or replace function public.service_other_real_posel_exists(p_exclude uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id is distinct from p_exclude
       and p.role = 'posel'::public.app_role
       and p.is_active
       and p.password_set
       and exists (
         select 1
           from auth.mfa_factors f
          where f.user_id = p.id
            and f.status = 'verified'
       )
  );
$$;

comment on function public.service_other_real_posel_exists(uuid) is
  'Czy poza p_exclude istnieje aktywny Posel z haslem i zweryfikowanym 2FA. Tylko service_role i trigger profiles_guard_role_active.';

revoke all on function public.service_other_real_posel_exists(uuid) from public, anon, authenticated;
grant execute on function public.service_other_real_posel_exists(uuid) to service_role;

-- ============================================================================
-- 2. Straznik roli / aktywnosci / ostatniego Posla
-- ============================================================================
create or replace function public.profiles_guard_role_active()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_uid uuid := auth.uid();
  v_touches_posel boolean;
  v_caller_role public.app_role;
begin
  if tg_op = 'INSERT' then
    v_touches_posel := new.role = 'posel'::public.app_role;
  else
    -- Wlasna rola / aktywnosc / usuniecie wlasnego profilu - zawsze z innego konta.
    if v_uid is not null and v_uid = old.id then
      if tg_op = 'DELETE'
         or new.role is distinct from old.role
         or new.is_active is distinct from old.is_active then
        raise exception 'Nie można zmienić własnej roli ani aktywności'
          using errcode = '42501';
      end if;
    end if;

    -- Usuniecie / zmiana roli / zmiana aktywnosci konta Posla albo nadanie roli 'posel'.
    v_touches_posel :=
      (old.role = 'posel'::public.app_role
        and (tg_op = 'DELETE'
             or new.role is distinct from old.role
             or new.is_active is distinct from old.is_active))
      or (tg_op = 'UPDATE'
          and new.role = 'posel'::public.app_role
          and old.role is distinct from new.role);
  end if;

  -- Konto Posla zmienia tylko Posel (administrator nie). Dotyczy zapisow z JWT uzytkownika;
  -- service_role (auth.uid() = null) sprawdza to w Edge Function przed zapisem.
  if v_uid is not null and v_touches_posel then
    select p.role into v_caller_role from public.profiles p where p.id = v_uid;
    if v_caller_role is distinct from 'posel'::public.app_role then
      raise exception 'Tylko Poseł może nadać, odebrać, aktywować lub dezaktywować konto Posła'
        using errcode = '42501';
    end if;
  end if;

  -- Ostatni prawdziwy Posel (rola 'posel', aktywny, haslo + zweryfikowane 2FA;
  -- administrator i nieprzyjete zaproszenia sie nie licza) musi zostac.
  if tg_op <> 'INSERT' then
    if old.role = 'posel'::public.app_role
       and old.is_active
       and (tg_op = 'DELETE'
            or new.role is distinct from old.role
            or new.is_active is distinct from true) then
      -- Serializacja rownoleglych zmian dwoch ostatnich Poslow.
      perform pg_advisory_xact_lock(hashtext('eposel.profiles_last_posel'));
      if not public.service_other_real_posel_exists(old.id) then
        raise exception 'Nie można usunąć ani zdezaktywować ostatniego aktywnego Posła'
          using errcode = '23514';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_guard_role_active() from public, anon, authenticated;

drop trigger if exists profiles_guard_role_active on public.profiles;
create trigger profiles_guard_role_active
  before insert or update of role, is_active or delete on public.profiles
  for each row execute function public.profiles_guard_role_active();

-- ============================================================================
-- 3. Wpis audytu z cooldownem (atomowo)
-- ============================================================================
-- Zwraca 0, gdy wpis zapisano (wolno wykonac akcje), albo liczbe sekund do konca
-- cooldownu, gdy w oknie p_cooldown_seconds jest juz wpis jednej z p_cooldown_actions
-- dla tej encji (nic nie zapisuje). Advisory lock per encja serializuje rownolegle
-- wywolania - drugie widzi wpis pierwszego po jego commicie.
create or replace function public.service_audit_claim_cooldown(
  p_user_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb,
  p_cooldown_actions text[],
  p_cooldown_seconds int
)
returns integer
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_last timestamptz;
begin
  if p_entity_id is null then
    raise exception 'p_entity_id wymagane' using errcode = '22023';
  end if;
  if p_cooldown_actions is null or cardinality(p_cooldown_actions) = 0 then
    raise exception 'p_cooldown_actions wymagane' using errcode = '22023';
  end if;
  if p_cooldown_seconds is null or p_cooldown_seconds < 1 or p_cooldown_seconds > 86400 then
    raise exception 'p_cooldown_seconds musi byc w zakresie 1..86400' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('audit_cooldown:' || p_entity_id::text, 0));

  select max(a.created_at)
    into v_last
    from public.audit_log a
   where a.entity_id = p_entity_id
     and a.action = any (p_cooldown_actions)
     and a.created_at > now() - make_interval(secs => p_cooldown_seconds);

  if v_last is not null then
    return greatest(
      1,
      ceil(extract(epoch from (v_last + make_interval(secs => p_cooldown_seconds) - now())))::int
    );
  end if;

  perform public.service_log_audit(p_user_id, p_action, p_entity_type, p_entity_id, p_metadata);
  return 0;
end;
$$;

comment on function public.service_audit_claim_cooldown(uuid, text, text, uuid, jsonb, text[], int) is
  'Atomowy wpis audytu z cooldownem per encja (admin-send-auth-link). 0 = zapisano, >0 = sekundy do konca cooldownu. Tylko service_role.';

revoke all on function public.service_audit_claim_cooldown(uuid, text, text, uuid, jsonb, text[], int)
  from public, anon, authenticated;
grant execute on function public.service_audit_claim_cooldown(uuid, text, text, uuid, jsonb, text[], int)
  to service_role;

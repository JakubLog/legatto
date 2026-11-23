-- compat-n-1: safe
-- Legatto self-host (A7): odbiór zgłoszeń z formularza strony posła (Cloudflare Queues -> intake).
--
-- Przepływ (D15b, R9): przeglądarka szyfruje formularz kluczem publicznym biura, Worker dokleja
-- podpis i zaszyfrowane metadane, kolejka trzyma kopertę stałej wielkości. Na serwerze biura:
--   legatto-intake fetch   - sieć + token kolejki, bez klucza i bez bazy (inbox/)
--   legatto-intake process - klucz X25519 + baza (rola legatto_intake), bez sieci zewnętrznej
-- process po weryfikacji podpisu i deszyfracji woła wyłącznie intake.submit_public_case(jsonb).
-- Rola legatto_intake nie ma innych uprawnień (bez service_role JWT w intake).
--
-- Idempotencja: public_submission_receipts(msg_id = id z plaintextu przeglądarki). Ten sam
-- formularz dostarczony ponownie (redelivery, replay koperty, ponowne wysłanie tego samego
-- szyfrogramu z nowym tokenem Turnstile) daje 'duplicate' i nie tworzy drugiej sprawy.
--
-- Funkcja Edge public-submit-case zostaje do cutoveru instancji z Vercela (tryb Vercel).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'legatto_intake') then
    create role legatto_intake login noinherit nocreatedb nocreaterole noreplication;
  end if;
end $$;

comment on role legatto_intake is
  'Legatto self-host: legatto-intake process. EXECUTE tylko na intake.submit_public_case(jsonb).';

create schema if not exists intake;
revoke all on schema intake from public;
grant usage on schema intake to legatto_intake;

alter table public.cases
  add column if not exists public_ref text
    constraint cases_public_ref_check check (public_ref is null or public_ref ~ '^[0-9a-f]{8}$');

comment on column public.cases.public_ref is
  'Numer potwierdzenia pokazany zgłaszającemu na stronie posła (8 znaków hex, sha256 szyfrogramu).';

create table if not exists intake.public_submission_receipts (
  msg_id       uuid        primary key,
  kind         text        not null constraint receipts_kind_check check (kind in ('submission', 'selftest')),
  outcome      text        not null
    constraint receipts_outcome_check check (outcome in ('inserted', 'rejected_validation', 'rejected_ratelimit', 'selftest')),
  reason       text,
  case_id      uuid        references public.cases(id) on delete set null,
  marker       text        constraint receipts_marker_check check (marker is null or marker ~ '^[0-9a-f]{32}$'),
  received_at  timestamptz not null,
  processed_at timestamptz not null default now()
);

comment on table intake.public_submission_receipts is
  'Pokwitowania kopert formularza (dedupe po id z plaintextu). Retencja 30 dni (pg_cron).';

create index if not exists public_submission_receipts_processed_idx
  on intake.public_submission_receipts (processed_at);

revoke all on intake.public_submission_receipts from public, anon, authenticated, legatto_intake;

-- Walidacja pola tekstowego formularza (obrona w głąb; ten sam kontrakt co
-- packages/public-submission): NFC, bez znaków sterujących (poza \n i \t w opisie),
-- bez znaków kierunku tekstu i BOM.
create or replace function intake.clean_text(p_value text, p_min int, p_max int, p_multiline boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(p_value);
begin
  if v is null then
    return null;
  end if;
  if v is not nfc normalized then
    return null;
  end if;
  if p_multiline then
    if v ~ '[\x01-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\ufeff]' then
      return null;
    end if;
  elsif v ~ '[\x01-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\ufeff]' then
    return null;
  end if;
  if char_length(v) < p_min or char_length(v) > p_max then
    return null;
  end if;
  return v;
end;
$$;

revoke all on function intake.clean_text(text, int, int, boolean) from public;

-- p: {"id":uuid,"kind":"submission"|"selftest","ref":"8hex","received_at":ISO,
--     "form":{...}|null, "meta":{"ip_hash":hex64,"ua":text}, "marker":hex32|null, "mode":"ping"|"verify"|null}
-- Wynik: inserted | duplicate | rejected_validation | rejected_ratelimit | selftest
create or replace function intake.submit_public_case(p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_kind text := p ->> 'kind';
  v_received timestamptz;
  v_form jsonb := p -> 'form';
  v_ip_hash text := p #>> '{meta,ip_hash}';
  v_ua text := left(coalesce(p #>> '{meta,ua}', ''), 512);
  v_ref text := p ->> 'ref';
  v_marker text := p ->> 'marker';
  v_name text;
  v_email text;
  v_phone text;
  v_title text;
  v_description text;
  v_powiat bigint;
  v_gmina bigint;
  v_category bigint;
  v_case_id uuid;
  v_reason text;
begin
  begin
    v_id := (p ->> 'id')::uuid;
    v_received := (p ->> 'received_at')::timestamptz;
  exception when others then
    raise exception 'intake: niepoprawne id/received_at' using errcode = '22023';
  end;
  if v_id is null or v_received is null or v_kind not in ('submission', 'selftest') then
    raise exception 'intake: brak id/received_at/kind' using errcode = '22023';
  end if;
  if v_ref is not null and v_ref !~ '^[0-9a-f]{8}$' then
    v_ref := null;
  end if;

  -- Dedupe: blokada na id, potem sprawdzenie pokwitowania.
  perform pg_advisory_xact_lock(hashtextextended('intake:' || v_id::text, 0));
  if exists (select 1 from intake.public_submission_receipts r where r.msg_id = v_id) then
    return 'duplicate';
  end if;

  if v_kind = 'selftest' then
    if v_marker is null or v_marker !~ '^[0-9a-f]{32}$' then
      raise exception 'intake: selftest bez znacznika' using errcode = '22023';
    end if;
    if p ->> 'mode' = 'verify' then
      insert into public.cases (title, description, status, priority, reporter_name, source, public_ref)
      values ('[VERIFY] ' || v_marker,
              'Zgłoszenie testowe legatto-intake selftest --mode verify. Można je usunąć.',
              'nowa', 'normal', 'legatto-intake selftest', 'public_form', v_ref)
      returning id into v_case_id;
    end if;
    insert into intake.public_submission_receipts (msg_id, kind, outcome, case_id, marker, received_at)
    values (v_id, 'selftest', 'selftest', v_case_id, v_marker, v_received);
    perform public.service_log_audit(null, 'intake.selftest', 'case', v_case_id,
      jsonb_build_object('marker', v_marker, 'mode', coalesce(p ->> 'mode', 'ping')));
    return 'selftest';
  end if;

  -- Walidacja (obrona w głąb - process waliduje tym samym schematem przed wywołaniem
  -- i przekazuje "invalid": "<pole>", gdy treść nie przeszła schematu).
  if p ? 'invalid' then
    v_reason := coalesce(substring(p ->> 'invalid' from '^[a-z_]{1,40}$'), 'form');
  elsif jsonb_typeof(v_form) is distinct from 'object' then
    v_reason := 'form';
  else
    v_name := intake.clean_text(v_form ->> 'reporter_name', 3, 100, false);
    v_email := nullif(btrim(coalesce(v_form ->> 'reporter_email', '')), '');
    v_phone := nullif(btrim(coalesce(v_form ->> 'reporter_phone', '')), '');
    v_title := intake.clean_text(v_form ->> 'title', 5, 200, false);
    v_description := intake.clean_text(v_form ->> 'description', 20, 5000, true);
    if v_name is null then v_reason := 'reporter_name';
    elsif v_email is null and v_phone is null then v_reason := 'contact';
    elsif v_email is not null and (char_length(v_email) > 254
          or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then v_reason := 'reporter_email';
    elsif v_phone is not null and v_phone !~ '^[+\d\s()-]{6,20}$' then v_reason := 'reporter_phone';
    elsif v_title is null then v_reason := 'title';
    elsif v_description is null then v_reason := 'description';
    elsif (v_form -> 'rodo_consent') is distinct from 'true'::jsonb then v_reason := 'rodo_consent';
    elsif jsonb_typeof(v_form -> 'powiat_id') is distinct from 'number'
          or (v_form ->> 'powiat_id') !~ '^[1-9][0-9]{0,8}$' then v_reason := 'powiat_id';
    elsif jsonb_typeof(v_form -> 'category_id') is distinct from 'number'
          or (v_form ->> 'category_id') !~ '^[1-9][0-9]{0,8}$' then v_reason := 'category_id';
    elsif coalesce(jsonb_typeof(v_form -> 'gmina_id'), 'null') <> 'null'
          and (jsonb_typeof(v_form -> 'gmina_id') <> 'number'
               or (v_form ->> 'gmina_id') !~ '^[1-9][0-9]{0,8}$') then v_reason := 'gmina_id';
    elsif v_ip_hash is null or v_ip_hash !~ '^[0-9a-f]{64}$' then v_reason := 'ip_hash';
    end if;
  end if;

  if v_reason is null then
    v_powiat := (v_form ->> 'powiat_id')::bigint;
    v_category := (v_form ->> 'category_id')::bigint;
    v_gmina := nullif(v_form ->> 'gmina_id', '')::bigint;
    if not exists (select 1 from public.powiaty pw where pw.id = v_powiat) then
      v_reason := 'powiat_fk';
    elsif v_gmina is not null and not exists (
            select 1 from public.gminy g where g.id = v_gmina and g.powiat_id = v_powiat) then
      v_reason := 'gmina_fk';
    elsif not exists (select 1 from public.case_categories c where c.id = v_category and c.is_system = true) then
      v_reason := 'category_fk';
    end if;
  end if;

  if v_reason is not null then
    insert into intake.public_submission_receipts (msg_id, kind, outcome, reason, received_at)
    values (v_id, 'submission', 'rejected_validation', v_reason, v_received);
    perform public.service_log_audit(null, 'intake.rejected', null, null,
      jsonb_build_object('outcome', 'rejected_validation', 'reason', v_reason));
    return 'rejected_validation';
  end if;

  -- Limity godzinowe (te same co public-submit-case): 3/h na hash adresu, 60/h globalnie.
  if not public.claim_public_submission_slot(v_ip_hash, 3, 3600)
     or not public.claim_public_submission_slot('global', 60, 3600) then
    insert into intake.public_submission_receipts (msg_id, kind, outcome, reason, received_at)
    values (v_id, 'submission', 'rejected_ratelimit', 'hourly', v_received);
    perform public.service_log_audit(null, 'intake.rejected', null, null,
      jsonb_build_object('outcome', 'rejected_ratelimit'));
    return 'rejected_ratelimit';
  end if;

  insert into public.cases (
    title, description, status, priority, category_id,
    reporter_name, reporter_email, reporter_phone, powiat_id, gmina_id,
    source, consent_newsletter, consent_contacts_db, submission_ip_hash, submission_user_agent, public_ref
  ) values (
    v_title, v_description, 'nowa', 'normal', v_category,
    v_name, v_email, v_phone, v_powiat, v_gmina,
    'public_form', (v_form -> 'consent_newsletter') = 'true'::jsonb,
    (v_form -> 'consent_contacts_db') = 'true'::jsonb, v_ip_hash, nullif(v_ua, ''), v_ref
  )
  returning id into v_case_id;

  insert into intake.public_submission_receipts (msg_id, kind, outcome, case_id, received_at)
  values (v_id, 'submission', 'inserted', v_case_id, v_received);

  perform public.service_log_audit(null, 'case.public_submission', 'case', v_case_id,
    jsonb_build_object('channel', 'site', 'ref', v_ref));
  return 'inserted';
end;
$$;

comment on function intake.submit_public_case(jsonb) is
  'Jedyna operacja roli legatto_intake: zapis zgłoszenia z formularza strony posła (idempotentny po id).';

revoke all on function intake.submit_public_case(jsonb) from public, anon, authenticated;
grant execute on function intake.submit_public_case(jsonb) to legatto_intake;

-- Retencja pokwitowań: 30 dni (dłużej niż retencja kolejki 14 dni + escrow).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('intake-receipts-retention', '40 3 * * *',
      $job$delete from intake.public_submission_receipts where processed_at < now() - interval '30 days'$job$);
  end if;
end $$;

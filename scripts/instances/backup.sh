#!/usr/bin/env bash
# Kopia zapasowa bazy instancji (pg_dump, format custom), szyfrowana kluczem publicznym age.
# Na planie Free Supabase nie robi kopii ani PITR (SAAS-1) - uruchamiaj z harmonogramu (np. codziennie)
# na maszynie operatora i trzymaj pliki poza projektem Supabase. Klucz prywatny age trzymaj offline.
#
# Kopia:
#   BACKUP_DB_URL='postgresql://postgres.<ref>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres' \
#   PGPASSWORD='<hasło bazy>' BACKUP_AGE_RECIPIENT='age1...' \
#     scripts/instances/backup.sh dump <katalog_docelowy> [etykieta]
#   (adres sesyjny poolera, port 5432, z Dashboard → Connect; hasło tylko w PGPASSWORD albo ~/.pgpass,
#    nigdy w BACKUP_DB_URL - nie trafia wtedy do argv/ps ani do logów).
#
# Odtworzenie do NOWEGO, pustego projektu Supabase (ta sama wersja Postgresa, bez `supabase db push`;
# schemat i historia migracji pochodzą z kopii):
#   RESTORE_DB_URL='postgresql://postgres.<nowy_ref>@...:5432/postgres' PGPASSWORD='<hasło nowej bazy>' \
#   BACKUP_AGE_IDENTITY=~/klucze/backup-age.txt \
#     scripts/instances/backup.sh restore <plik.dump.age>
#   Kolejność: rozszerzenia → dane auth/storage (bez tabel migracji) → schemat, dane i ACL public + historia
#   migracji → polityki storage.objects → zadania pg_cron. Potem: provision.mjs, `supabase functions deploy`,
#   Vercel env, doctor.mjs.
#
# Kopia obejmuje tylko bazę. Pliki ze Storage (załączniki, site-assets) leżą poza Postgresem - kopiuj je osobno
# (np. `supabase storage cp -r ss:///<bucket> <katalog> --experimental`).
set -euo pipefail
umask 077

usage() {
  sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "Brak programu: $1" >&2; exit 2; }
}

no_password_in_url() {
  if [[ "$1" =~ ://[^/@]*:[^/@]*@ ]]; then
    echo "Adres bazy zawiera hasło - usuń je z URL i podaj w PGPASSWORD albo ~/.pgpass." >&2
    exit 2
  fi
}

cmd=${1:-}
case "$cmd" in
  dump)
    [[ $# -ge 2 ]] || usage
    : "${BACKUP_DB_URL:?Ustaw BACKUP_DB_URL (bez hasła)}" "${BACKUP_AGE_RECIPIENT:?Ustaw BACKUP_AGE_RECIPIENT (klucz publiczny age1...)}"
    require pg_dump; require age
    no_password_in_url "$BACKUP_DB_URL"
    target=$2
    label=${3:-instancja}
    mkdir -p "$target"
    out="$target/$label-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
    partial="$out.partial"
    trap 'rm -f "$partial"' EXIT
    pg_dump --format=custom --compress=6 --dbname="$BACKUP_DB_URL" | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$partial"
    mv "$partial" "$out"
    trap - EXIT
    echo "Kopia: $out ($(wc -c <"$out" | tr -d ' ') B)"
    ;;
  restore)
    [[ $# -eq 2 ]] || usage
    : "${RESTORE_DB_URL:?Ustaw RESTORE_DB_URL (bez hasła)}" "${BACKUP_AGE_IDENTITY:?Ustaw BACKUP_AGE_IDENTITY (plik klucza prywatnego age)}"
    require pg_restore; require psql; require age
    no_password_in_url "$RESTORE_DB_URL"
    work=$(mktemp -d)
    trap 'rm -f "$work"/*; rmdir "$work"' EXIT
    age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "$work/db.dump" "$2"
    pg_restore --list "$work/db.dump" >"$work/all.list"

    # 1. Rozszerzenia (pg_net, pg_cron, ...) - w kopii jako CREATE EXTENSION IF NOT EXISTS.
    grep -E '^[0-9]+; [0-9]+ [0-9]+ EXTENSION - ' "$work/all.list" >"$work/ext.list" || true
    pg_restore --use-list="$work/ext.list" --dbname="$RESTORE_DB_URL" --exit-on-error "$work/db.dump"

    # 2. Dane kont i metadanych Storage (schematy zarządza Supabase). Kolejność tabel w kopii nie uwzględnia
    #    kluczy obcych, więc w trybie replica (bez triggerów i sprawdzania FK), w jednej transakcji.
    grep -E '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA (auth [a-z_]+|storage (buckets|objects)) ' "$work/all.list" \
      | grep -v -E ' TABLE DATA auth schema_migrations ' >"$work/data.list"
    {
      echo 'set session_replication_role = replica;'
      pg_restore --use-list="$work/data.list" --data-only --file=- "$work/db.dump"
    } | psql --dbname="$RESTORE_DB_URL" --no-psqlrc --quiet --single-transaction --set=ON_ERROR_STOP=1 >/dev/null

    # 3. Schemat, dane, RLS i uprawnienia aplikacji (domyślne uprawnienia supabase_admin ustawia platforma).
    #    Nowy projekt nadaje anon/authenticated/service_role prawa do każdego nowego obiektu (domyślne uprawnienia
    #    postgres), a kopia zapisuje uprawnienia względem domyślnych Postgresa - dlatego obiekty bez ACL, potem
    #    odebranie praw i dopiero ACL z kopii. Inaczej anon dostałby EXECUTE na wszystkich funkcjach.
    pg_restore --list --schema=public "$work/db.dump" | grep -v -E ' DEFAULT ACL .* supabase_admin$' >"$work/public.list"
    grep -v -E '^[0-9]+; [0-9]+ [0-9]+ ACL public ' "$work/public.list" >"$work/public-objects.list"
    grep -E '^[0-9]+; [0-9]+ [0-9]+ ACL public ' "$work/public.list" >"$work/public-acl.list" || true
    pg_restore --use-list="$work/public-objects.list" --no-owner --dbname="$RESTORE_DB_URL" --exit-on-error "$work/db.dump"
    psql --dbname="$RESTORE_DB_URL" --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --command="
      revoke all on all tables in schema public from public, anon, authenticated, service_role;
      revoke all on all sequences in schema public from public, anon, authenticated, service_role;
      revoke all on all functions in schema public from public, anon, authenticated, service_role;"
    pg_restore --use-list="$work/public-acl.list" --dbname="$RESTORE_DB_URL" --exit-on-error "$work/db.dump"
    # Historia migracji (`supabase migration list`); tabelę mógł już założyć CLI - wtedy same dane.
    history=$(psql --dbname="$RESTORE_DB_URL" --no-psqlrc --tuples-only --no-align \
      --command="select to_regclass('supabase_migrations.schema_migrations') is not null")
    if [[ "$history" == "t" ]]; then
      pg_restore --schema=supabase_migrations --data-only --dbname="$RESTORE_DB_URL" --exit-on-error "$work/db.dump"
    else
      psql --dbname="$RESTORE_DB_URL" --no-psqlrc --quiet --command="create schema if not exists supabase_migrations;"
      pg_restore --schema=supabase_migrations --no-owner --dbname="$RESTORE_DB_URL" --exit-on-error "$work/db.dump"
    fi

    # 4. Polityki aplikacji na storage.objects (odwołują się do funkcji z public, więc po kroku 3).
    grep -E '^[0-9]+; [0-9]+ [0-9]+ POLICY storage ' "$work/all.list" >"$work/policy.list" || true
    pg_restore --use-list="$work/policy.list" --dbname="$RESTORE_DB_URL" --exit-on-error "$work/db.dump"
    # 5. Zadania pg_cron (cron.job nie przyjmuje COPY - odtwarzamy przez cron.schedule).
    if grep -E '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA cron job ' "$work/all.list" >"$work/cron.list"; then
      {
        echo 'create temp table cron_job_restore (jobid bigint, schedule text, command text, nodename text, nodeport int,'
        echo '  database text, username text, active boolean, jobname text);'
        pg_restore --use-list="$work/cron.list" --data-only --file=- "$work/db.dump" | sed 's/^COPY cron\.job /COPY cron_job_restore /'
        echo 'select cron.schedule(jobname, schedule, command) from cron_job_restore where active and jobname is not null;'
      } | psql --dbname="$RESTORE_DB_URL" --no-psqlrc --quiet --single-transaction --set=ON_ERROR_STOP=1 >/dev/null
    fi
    psql --dbname="$RESTORE_DB_URL" --no-psqlrc --quiet --command="notify pgrst, 'reload schema';"
    echo "Odtworzono z $2. Dalej: provision.mjs, supabase functions deploy, Vercel env, doctor.mjs, pliki Storage."
    ;;
  *)
    usage
    ;;
esac

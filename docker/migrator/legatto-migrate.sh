#!/bin/sh
# Migrator bazy VPS biura (obraz `migrator`): stosuje supabase/migrations w kolejności nazw, każdy plik
# w osobnej transakcji, idempotentnie. Historia w supabase_migrations.schema_migrations (ta sama
# tabela co Supabase CLI) oraz sha256 każdego pliku w supabase_migrations.legatto_checksums.
#
#   legatto-migrate [migrate]        zastosuj brakujące migracje (domyślnie)
#   legatto-migrate status [--json]  stan: zastosowane, oczekujące, ostatnia wersja
#   legatto-migrate check            walidacja bez zmian (walidator applier'a sql-migrations)
#
# Połączenie: PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD (env kontenera).
# Kody wyjścia: 0 OK, 1 błąd, 2 błędne argumenty, 3 blokada zajęta (inny migrator),
#               10 walidacja nieudana (nazwy, kolejność, zmieniony plik), 11 migracja nieudana.
set -eu

MIGRATIONS_DIR=${LEGATTO_MIGRATIONS_DIR:-/migrations}
POST_SQL=${LEGATTO_POST_SQL:-/usr/local/share/legatto/selfhost.sql}
# pg_advisory_lock: stała klasy blokady migratora ("legatto-migrate").
LOCK_KEY=7466346578
NAME_RE='^[0-9]\{14\}_[a-z0-9_]\{1,100\}\.sql$'
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

log() { printf 'legatto-migrate: %s\n' "$*" >&2; }
die() { code=$1; shift; log "$*"; exit "$code"; }

psql_q() { psql -X -q -v ON_ERROR_STOP=1 -At "$@"; }

# Lista plików obrazu: "<wersja> <sha256> <plik>" posortowana po nazwie.
local_files() {
  : >"$WORK/local"
  for path in "$MIGRATIONS_DIR"/*.sql; do
    [ -e "$path" ] || continue
    file=${path##*/}
    printf '%s\n' "$file" | grep -q "$NAME_RE" || die 10 "niepoprawna nazwa migracji: $file"
    sum=$(sha256sum "$path" | cut -d' ' -f1)
    printf '%s %s %s\n' "${file%%_*}" "$sum" "$file" >>"$WORK/local"
  done
  sort -o "$WORK/local" "$WORK/local"
  [ -s "$WORK/local" ] || die 10 "brak migracji w $MIGRATIONS_DIR"
  dup=$(cut -d' ' -f1 "$WORK/local" | uniq -d | head -n 1)
  [ -z "$dup" ] || die 10 "zdublowana wersja migracji: $dup"
}

# Stan bazy: "<wersja> <sha256 albo ->" dla zastosowanych migracji. Brak tabeli historii = pierwsza
# instalacja; brak tabeli sum = historia z Supabase CLI (sumy uzupełni migrate).
db_state() {
  tables=$(psql_q -c "select (to_regclass('supabase_migrations.schema_migrations') is not null)::int::text
                      || (to_regclass('supabase_migrations.legatto_checksums') is not null)::int::text") \
    || die 1 "nie można odczytać stanu bazy (połączenie, uprawnienia)"
  case "$tables" in
    0?) : >"$WORK/db" ;;
    10) psql_q -c "select version || ' -' from supabase_migrations.schema_migrations order by version" >"$WORK/db" \
          || die 1 "nie można odczytać historii migracji" ;;
    11) psql_q -c "select m.version || ' ' || coalesce(c.sha256, '-')
                   from supabase_migrations.schema_migrations m
                   left join supabase_migrations.legatto_checksums c using (version)
                   order by m.version" >"$WORK/db" \
          || die 1 "nie można odczytać historii migracji" ;;
    *) die 1 "nieoczekiwany stan tabel historii: $tables" ;;
  esac
}

# Porównanie: zmieniony plik / migracja starsza niż ostatnia zastosowana = błąd walidacji.
# Wynik: $WORK/pending (pliki do zastosowania), $WORK/backfill (wersje bez sumy w bazie).
compare() {
  : >"$WORK/pending"
  : >"$WORK/backfill"
  last_applied=$(tail -n 1 "$WORK/db" | cut -d' ' -f1)
  status=0
  while read -r version sum file; do
    applied=$(grep "^$version " "$WORK/db" | cut -d' ' -f2 || true)
    if [ -n "$applied" ]; then
      if [ "$applied" = "-" ]; then
        printf '%s %s %s\n' "$version" "$sum" "$file" >>"$WORK/backfill"
      elif [ "$applied" != "$sum" ]; then
        log "zastosowana migracja $file ma inny sha256 niż w bazie"
        status=10
      fi
    else
      if [ -n "$last_applied" ] && [ "$version" -lt "$last_applied" ]; then
        log "migracja $file jest starsza niż ostatnia zastosowana ($last_applied)"
        status=10
      fi
      printf '%s %s %s\n' "$version" "$sum" "$file" >>"$WORK/pending"
    fi
  done <"$WORK/local"
  # Wersje w bazie nieobecne w obrazie: baza z nowszego wydania (rollback obrazów) - dozwolone.
  newer=$(cut -d' ' -f1 "$WORK/db" | while read -r v; do grep -q "^$v " "$WORK/local" || echo "$v"; done | wc -l | tr -d ' ')
  [ "$newer" = "0" ] || log "baza ma $newer migracji spoza tego obrazu (nowsze wydanie) - bez zmian"
  return "$status"
}

sql_literal() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }

# Jedna linia skryptu psql (printf: `echo` w sh interpretuje sekwencje z odwrotnym ukośnikiem).
line() { printf '%s\n' "$*"; }

write_driver() {
  driver=$WORK/driver.sql
  {
    line '\set ON_ERROR_STOP on'
    line "set lock_timeout = '10s';"
    line "select pg_advisory_lock($LOCK_KEY) as legatto_locked \\gset"
    line 'reset lock_timeout;'
    line 'create schema if not exists supabase_migrations;'
    line 'create table if not exists supabase_migrations.schema_migrations (version text not null primary key);'
    line 'alter table supabase_migrations.schema_migrations add column if not exists statements text[];'
    line 'alter table supabase_migrations.schema_migrations add column if not exists name text;'
    line 'create table if not exists supabase_migrations.legatto_checksums ('
    line '  version text not null primary key, name text not null, sha256 text not null,'
    line '  applied_at timestamptz not null default now());'
    # Historia sprzed migratora (np. baza przeniesiona z Supabase Cloud): suma z obrazu (pierwsze użycie).
    while read -r version sum file; do
      line "insert into supabase_migrations.legatto_checksums (version, name, sha256) values ($(sql_literal "$version"), $(sql_literal "$file"), $(sql_literal "$sum")) on conflict (version) do nothing;"
    done <"$WORK/backfill"
    while read -r version sum file; do
      name=${file#*_}
      name=${name%.sql}
      line "\\echo legatto-migrate: $file"
      line 'begin;'
      line "\\i $MIGRATIONS_DIR/$file"
      line "\\set legatto_sql \`cat $MIGRATIONS_DIR/$file\`"
      line "insert into supabase_migrations.schema_migrations (version, name, statements) values ($(sql_literal "$version"), $(sql_literal "$name"), array[:'legatto_sql']);"
      line "insert into supabase_migrations.legatto_checksums (version, name, sha256) values ($(sql_literal "$version"), $(sql_literal "$file"), $(sql_literal "$sum"));"
      line 'commit;'
      # Ustawienia sesji z migracji (search_path, role) nie przechodzą na następny plik.
      line 'reset all;'
    done <"$WORK/pending"
    if [ -f "$POST_SQL" ]; then
      line "\\i $POST_SQL"
    fi
    line "select pg_advisory_unlock($LOCK_KEY) as legatto_unlocked \\gset"
  } >"$driver"
}

cmd_migrate() {
  local_files
  db_state
  compare || die 10 "walidacja nieudana - nic nie zastosowano"
  count=$(wc -l <"$WORK/pending" | tr -d ' ')
  write_driver
  if ! psql -X -q -v ON_ERROR_STOP=1 -f "$WORK/driver.sql" 2>"$WORK/err"; then
    cat "$WORK/err" >&2
    if grep -q 'lock timeout' "$WORK/err"; then die 3 "inny migrator trzyma blokadę"; fi
    die 11 "migracja nieudana (transakcja pliku wycofana)"
  fi
  db_state
  log "zastosowano $count, w bazie $(wc -l <"$WORK/db" | tr -d ' '), ostatnia $(tail -n 1 "$WORK/db" | cut -d' ' -f1)"
}

cmd_status() {
  json=0
  [ "${1:-}" = "--json" ] && json=1
  local_files
  db_state
  valid=true
  compare || valid=false
  applied=$(wc -l <"$WORK/db" | tr -d ' ')
  pending=$(wc -l <"$WORK/pending" | tr -d ' ')
  last=$(tail -n 1 "$WORK/db" | cut -d' ' -f1)
  latest=$(tail -n 1 "$WORK/local" | cut -d' ' -f1)
  if [ "$json" -eq 1 ]; then
    printf '{"applied":%s,"pending":%s,"last_applied":%s,"latest_in_image":%s,"valid":%s}\n' \
      "$applied" "$pending" "$([ -n "$last" ] && printf '"%s"' "$last" || printf null)" \
      "$([ -n "$latest" ] && printf '"%s"' "$latest" || printf null)" "$valid"
  else
    printf 'zastosowane: %s\noczekujące: %s\nostatnia w bazie: %s\nostatnia w obrazie: %s\nwalidacja: %s\n' \
      "$applied" "$pending" "${last:-brak}" "${latest:-brak}" "$valid"
  fi
}

cmd_check() {
  local_files
  db_state
  compare || die 10 "walidacja nieudana"
  log "walidacja OK ($(wc -l <"$WORK/pending" | tr -d ' ') do zastosowania)"
}

case "${1:-migrate}" in
  migrate) [ $# -le 1 ] || die 2 "migrate nie przyjmuje argumentów"; cmd_migrate ;;
  status) shift; [ $# -le 1 ] || die 2 "użycie: status [--json]"; cmd_status "$@" ;;
  check) [ $# -le 1 ] || die 2 "check nie przyjmuje argumentów"; cmd_check ;;
  *) die 2 "użycie: legatto-migrate [migrate|status [--json]|check]" ;;
esac

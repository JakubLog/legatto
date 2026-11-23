# shellcheck shell=bash
# Baza jak na VPS biura w kolejności startu stosu: supabase/postgres → auth (migracje GoTrue) →
# storage (schemat storage) → dopiero potem migrator legatto. Biblioteka dla
# scripts/ci/test-migrator.sh i scripts/ci/compat-n-1.sh (source, nie uruchamiać).
#
#   stack_up <prefiks>     start bazy, migracje auth i storage; ustawia STACK_DB (nazwa kontenera)
#   stack_psql [args]      psql jako supabase_admin w kontenerze bazy
#   stack_migrator <obraz> [args]   kontener migratora w sieci bazy (PGUSER=postgres jak migrator.env)
#   stack_down             usunięcie kontenerów
#
# Obrazy = legatto-infra ansible/group_vars/all/versions.yml (db, auth, storage; index digest).
STACK_PG_IMAGE="${LEGATTO_TEST_PG_IMAGE:-docker.io/supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00}"
STACK_GOTRUE_IMAGE="${LEGATTO_TEST_GOTRUE_IMAGE:-docker.io/supabase/gotrue:v2.197.0@sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b}"
STACK_STORAGE_IMAGE="${LEGATTO_TEST_STORAGE_IMAGE:-docker.io/supabase/storage-api:v1.89.12@sha256:8526956cb462e9f7d392e9848ec77133b2769982ed614e9753cc687e8e4339a6}"
# Hasła wyłącznie testowe (kontenery bez portów na hoście, usuwane po teście).
STACK_PASSWORD=legatto-test-only
STACK_JWT_SECRET=legatto-test-jwt-secret-0123456789abcdef
STACK_DB=""
STACK_STORAGE=""

stack_psql() {
  docker exec -i "$STACK_DB" psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@"
}

stack_down() {
  local c
  for c in "$STACK_STORAGE" "$STACK_DB"; do
    [[ -n "$c" ]] && docker rm -f "$c" >/dev/null 2>&1
  done
  return 0
}

stack_up() {
  local prefix=$1 ready=""
  STACK_DB="$prefix-db-$$"
  STACK_STORAGE="$prefix-storage-$$"
  # Parametry serwera jak w compose biura (legatto.surface_enforce: A5, sprawdza migrator).
  docker run -d --name "$STACK_DB" -e POSTGRES_PASSWORD="$STACK_PASSWORD" "$STACK_PG_IMAGE" \
    postgres -c config_file=/etc/postgresql/postgresql.conf -c legatto.surface_enforce=on >/dev/null
  for _ in $(seq 1 90); do
    if docker exec "$STACK_DB" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 \
      && [[ "$(stack_psql -tAc 'select 1' 2>/dev/null)" == 1 ]]; then
      ready=1
      break
    fi
    sleep 1
  done
  [[ -n "$ready" ]] || { echo "db-stack: baza nie wystartowała" >&2; return 1; }
  # Obraz supabase/postgres kończy init skryptami po pierwszym pg_isready: poczekaj na role usług.
  ready=""
  for _ in $(seq 1 60); do
    if [[ "$(stack_psql -tAc "select count(*) from pg_roles where rolname in ('supabase_auth_admin','supabase_storage_admin','authenticated')" 2>/dev/null)" == 3 ]]; then
      ready=1
      break
    fi
    sleep 1
  done
  [[ -n "$ready" ]] || { echo "db-stack: brak ról usług Supabase" >&2; return 1; }
  stack_psql <<SQL
alter role supabase_auth_admin with login password '$STACK_PASSWORD';
alter role supabase_storage_admin with login password '$STACK_PASSWORD';
alter role postgres with login password '$STACK_PASSWORD';
SQL

  echo "db-stack: migracje auth (GoTrue)" >&2
  docker run --rm --network "container:$STACK_DB" \
    -e GOTRUE_DB_DRIVER=postgres \
    -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$STACK_PASSWORD@127.0.0.1:5432/postgres" \
    -e GOTRUE_SITE_URL=http://localhost -e API_EXTERNAL_URL=http://localhost \
    -e GOTRUE_JWT_SECRET="$STACK_JWT_SECRET" \
    "$STACK_GOTRUE_IMAGE" auth migrate >/dev/null 2>&1 \
    || { echo "db-stack: migracje GoTrue nieudane" >&2; return 1; }

  echo "db-stack: schemat storage (storage-api)" >&2
  docker run -d --name "$STACK_STORAGE" --network "container:$STACK_DB" \
    -e DATABASE_URL="postgres://supabase_storage_admin:$STACK_PASSWORD@127.0.0.1:5432/postgres" \
    -e ANON_KEY=unused -e SERVICE_KEY=unused \
    -e PGRST_JWT_SECRET="$STACK_JWT_SECRET" -e AUTH_JWT_SECRET="$STACK_JWT_SECRET" \
    -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/tmp/storage -e TENANT_ID=stub -e REGION=stub \
    -e GLOBAL_S3_BUCKET=stub -e SERVER_PORT=5999 \
    "$STACK_STORAGE_IMAGE" >/dev/null
  ready=""
  for _ in $(seq 1 90); do
    if [[ "$(docker inspect -f '{{.State.Running}}' "$STACK_STORAGE" 2>/dev/null)" != true ]]; then
      docker logs "$STACK_STORAGE" 2>&1 | tail -20 >&2
      echo "db-stack: storage-api zakończył się przed utworzeniem schematu" >&2
      return 1
    fi
    # storage-api słucha dopiero po własnych migracjach schematu storage.
    if docker exec "$STACK_STORAGE" node -e "fetch('http://127.0.0.1:5999/status').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 2
  done
  [[ -n "$ready" ]] || { echo "db-stack: storage-api nie zgłosił gotowości" >&2; return 1; }
  docker rm -f "$STACK_STORAGE" >/dev/null
  STACK_STORAGE=""
  [[ "$(stack_psql -tAc "select to_regclass('storage.buckets') is not null and to_regclass('auth.users') is not null")" == t ]] \
    || { echo "db-stack: brak auth.users lub storage.buckets po starcie usług" >&2; return 1; }
}

# Migrator w sieci bazy; reszta argumentów = komenda legatto-migrate. Dodatkowe opcje docker run
# (np. montowanie innego katalogu migracji) w tablicy STACK_MIGRATOR_DOCKER_ARGS.
stack_migrator() {
  local image=$1
  shift
  docker run --rm --network "container:$STACK_DB" --read-only --tmpfs /tmp --cap-drop ALL \
    -e PGHOST=127.0.0.1 -e PGUSER=postgres -e PGPASSWORD="$STACK_PASSWORD" \
    ${STACK_MIGRATOR_DOCKER_ARGS[@]+"${STACK_MIGRATOR_DOCKER_ARGS[@]}"} "$image" "$@"
}
STACK_MIGRATOR_DOCKER_ARGS=()

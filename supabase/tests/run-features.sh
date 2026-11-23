#!/usr/bin/env bash
# Testy migracji Legatto na świeżym Postgresie Supabase w Dockerze (bez `supabase start`):
#   1. supabase/postgres + migracje GoTrue (auth) i Storage z oficjalnych obrazów,
#   2. wszystkie supabase/migrations/*.sql dwa razy (drugi przebieg = idempotencja migracji Legatto),
#   3. supabase/tests/features.sql (asercje A5-A8, A12, A13).
# Użycie: supabase/tests/run-features.sh   (wymaga Dockera; port losowy na 127.0.0.1)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_IMAGE="${LEGATTO_TEST_PG_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.167}"
GOTRUE_IMAGE="${LEGATTO_TEST_GOTRUE_IMAGE:-public.ecr.aws/supabase/gotrue:v2.198.0}"
STORAGE_IMAGE="${LEGATTO_TEST_STORAGE_IMAGE:-public.ecr.aws/supabase/storage-api:v1.96.4}"
DB="legatto-features-db-$$"
STORAGE="legatto-features-storage-$$"
JWT_SECRET="legatto-test-jwt-secret-0123456789abcdef"

cleanup() {
  docker rm -f "$DB" "$STORAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql_db() {
  docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@"
}

docker run -d --name "$DB" -e POSTGRES_PASSWORD=postgres "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$DB" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; then break; fi
  sleep 1
done
sleep 4

psql_db <<'SQL'
alter role supabase_auth_admin with login password 'postgres';
alter role supabase_storage_admin with login password 'postgres';
SQL

echo "== migracje GoTrue"
docker run --rm --network "container:$DB" \
  -e GOTRUE_DB_DRIVER=postgres \
  -e GOTRUE_DB_DATABASE_URL='postgres://supabase_auth_admin:postgres@127.0.0.1:5432/postgres' \
  -e GOTRUE_SITE_URL=http://localhost -e API_EXTERNAL_URL=http://localhost \
  -e GOTRUE_JWT_SECRET="$JWT_SECRET" \
  "$GOTRUE_IMAGE" auth migrate >/dev/null 2>&1

echo "== migracje Storage"
docker run -d --name "$STORAGE" --network "container:$DB" \
  -e DATABASE_URL='postgres://supabase_storage_admin:postgres@127.0.0.1:5432/postgres' \
  -e ANON_KEY=unused -e SERVICE_KEY=unused -e PGRST_JWT_SECRET="$JWT_SECRET" -e AUTH_JWT_SECRET="$JWT_SECRET" \
  -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/tmp/storage -e TENANT_ID=test -e REGION=test \
  -e GLOBAL_S3_BUCKET=test -e SERVER_PORT=5999 \
  "$STORAGE_IMAGE" >/dev/null
ready=""
for _ in $(seq 1 90); do
  if [ "$(psql_db -tAc "select to_regprocedure('storage.foldername(text)') is not null and to_regclass('storage.objects') is not null")" = "t" ]; then
    ready=1
    break
  fi
  sleep 2
done
if [ -z "$ready" ]; then
  echo "Storage nie utworzył schematu" >&2
  exit 1
fi
sleep 8
docker rm -f "$STORAGE" >/dev/null

for pass in 1 2; do
  echo "== migracje aplikacji (przebieg $pass)"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    base="$(basename "$f")"
    # Drugi przebieg tylko dla migracji Legatto self-host (starsze migracje nie są idempotentne).
    if [ "$pass" = 2 ] && [ "${base%%_*}" -lt 20261121200000 ]; then continue; fi
    if ! psql_db < "$f" >/tmp/legatto-features-migration.log 2>&1; then
      echo "BŁĄD migracji $base (przebieg $pass):" >&2
      tail -20 /tmp/legatto-features-migration.log >&2
      exit 1
    fi
  done
done

echo "== migracje etapu contract (supabase/migrations-contract)"
for f in "$ROOT"/supabase/migrations-contract/*.sql; do
  [ -e "$f" ] || continue
  if ! psql_db < "$f" >/tmp/legatto-features-migration.log 2>&1; then
    echo "BŁĄD migracji contract $(basename "$f"):" >&2
    tail -20 /tmp/legatto-features-migration.log >&2
    exit 1
  fi
done

echo "== testy funkcji"
psql_db -At < "$ROOT/supabase/tests/features.sql"

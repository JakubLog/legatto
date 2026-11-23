#!/usr/bin/env bash
# Job compat-n-1: kod poprzedniego wydania (N-1) działa na schemacie po migracjach N.
# Scenariusz jak aktualizacja VPS (rollback obrazów zostawia bazę w stanie N):
#   1. stos bazy (auth i storage przed migratorem), migrator N z migracjami N-1 → powierzchnia „przed”,
#   2. migrator N z migracjami N (upgrade)                                         → powierzchnia „po”,
#   3. każdy obiekt używany przez kod N-1 (tabele/kolumny/uprawnienia, RPC i argumenty, kubełki)
#      musi przetrwać (scripts/ci/compat-n-1.mjs compare),
#   4. testy SQL wydania N-1 (supabase/tests/features.sql, jeśli istnieją) na schemacie N.
#
#   scripts/ci/compat-n-1.sh [--previous <ref>] [--image <obraz migratora N>]
# Domyślne N-1: najnowszy tag v* osiągalny z HEAD^ (tag na HEAD to samo wydanie N). Bez wcześniejszego
# wydania nie ma czego porównywać - job kończy się sukcesem z komunikatem.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/ci/db-stack.sh
. "$ROOT/scripts/ci/db-stack.sh"

previous="" image=""
while (($#)); do
  case "$1" in
    --previous) previous="${2:-}"; shift 2 ;;
    --image) image="${2:-}"; shift 2 ;;
    *) echo "użycie: compat-n-1.sh [--previous <ref>] [--image <obraz>]" >&2; exit 2 ;;
  esac
done
cd "$ROOT"
if [[ -z "$previous" ]]; then
  previous="$(git describe --tags --abbrev=0 --match 'v[0-9]*' HEAD^ 2>/dev/null || true)"
  if [[ -z "$previous" ]]; then
    echo "compat-n-1: brak poprzedniego wydania (tag v* przed HEAD) - pierwsze wydanie, nic do porównania"
    exit 0
  fi
fi
git rev-parse --verify --quiet "$previous^{commit}" >/dev/null || { echo "compat-n-1: nieznany ref $previous" >&2; exit 2; }
echo "compat-n-1: N-1 = $previous ($(git rev-parse --short "$previous^{commit}")), N = $(git rev-parse --short HEAD)"

work="$(mktemp -d)"
if [[ -z "$image" ]]; then
  image="legatto-migrator:compat-$$"
  docker build -q -f docker/migrator/Dockerfile -t "$image" . >/dev/null
  built=1
fi
cleanup() {
  stack_down
  [[ -n "${built:-}" ]] && docker rmi -f "$image" >/dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT

mkdir -p "$work/prev"
paths=()
for p in supabase src api server; do
  [[ -n "$(git ls-tree --name-only "$previous" -- "$p")" ]] && paths+=("$p")
done
git archive --format=tar "$previous" -- "${paths[@]}" | tar -xf - -C "$work/prev"
chmod -R a+rX "$work/prev/supabase/migrations"

# Powierzchnia schematu: tabele i kolumny, uprawnienia ról API, funkcje (argumenty wejściowe,
# EXECUTE), kubełki Storage. Jedna linia TSV na element.
SURFACE_SQL=$(cat <<'SQL'
with rels as (
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
), roles(r) as (values ('anon'), ('authenticated'), ('service_role')),
privs(p) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')),
funcs as (
  select p.oid, p.proname, p.proargnames, p.proargmodes from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
)
select format(E'table\t%s\t%s', rels.relname, a.attname) from rels
  join pg_attribute a on a.attrelid = rels.oid and a.attnum > 0 and not a.attisdropped
union
select format(E'tgrant\t%s\t%s\t%s', rels.relname, r, p) from rels, roles, privs
  where case when p = 'DELETE' then has_table_privilege(r, rels.oid, p) else has_any_column_privilege(r, rels.oid, p) end
union
select format(E'func\t%s', proname) from funcs
union
select format(E'farg\t%s\t%s', f.proname, a.name) from funcs f
  cross join lateral unnest(coalesce(f.proargnames, '{}'), coalesce(f.proargmodes, array_fill('i'::"char", array[coalesce(cardinality(f.proargnames), 0)]))) as a(name, mode)
  where a.mode in ('i', 'b', 'v') and a.name <> ''
union
select format(E'fexec\t%s\t%s', f.proname, r) from funcs f, roles where has_function_privilege(r, f.oid, 'EXECUTE')
union
select format(E'bucket\t%s', id) from storage.buckets
order by 1;
SQL
)

stack_up legatto-compat

echo "== migracje N-1 ($previous)"
STACK_MIGRATOR_DOCKER_ARGS=(-v "$work/prev/supabase/migrations:/migrations:ro")
stack_migrator "$image" migrate 2>"$work/m1.log" || { grep -v NOTICE "$work/m1.log" | tail -30 >&2; exit 1; }
STACK_MIGRATOR_DOCKER_ARGS=()
tail -1 "$work/m1.log"
stack_psql -tA <<<"$SURFACE_SQL" >"$work/before.tsv"

echo "== migracje N (upgrade)"
stack_migrator "$image" migrate 2>"$work/m2.log" || { grep -v NOTICE "$work/m2.log" | tail -30 >&2; exit 1; }
tail -1 "$work/m2.log"
stack_psql -tA <<<"$SURFACE_SQL" >"$work/after.tsv"

echo "== obiekty schematu używane przez kod N-1"
node scripts/ci/compat-n-1.mjs refs "$work/prev" >"$work/refs.json"
node scripts/ci/compat-n-1.mjs compare "$work/refs.json" "$work/before.tsv" "$work/after.tsv"

if [[ -f "$work/prev/supabase/tests/features.sql" ]]; then
  echo "== testy SQL N-1 na schemacie N"
  stack_psql -At <"$work/prev/supabase/tests/features.sql" >/dev/null
  echo "compat-n-1: testy SQL N-1 OK"
else
  echo "compat-n-1: N-1 nie ma supabase/tests/features.sql - pominięte"
fi
echo "compat-n-1: OK"

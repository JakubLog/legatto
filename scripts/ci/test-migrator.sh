#!/usr/bin/env bash
# Test idempotencji obrazu `migrator` na stosie jak na VPS (auth i storage przed migratorem):
#   1. migrate         - pierwsza instalacja, wszystkie migracje
#   2. check           - walidacja bez zmian (kod 0)
#   3. migrate         - drugi przebieg: 0 zastosowanych, schemat bajtowo ten sam (pg_dump)
#   4. status --json   - pending 0, valid true, applied = liczba plików
#   5. check na kopii z jedną zmienioną zastosowaną migracją - kod 10
#
#   scripts/ci/test-migrator.sh [--image <obraz>]   (domyślnie build docker/migrator/Dockerfile)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/ci/db-stack.sh
. "$ROOT/scripts/ci/db-stack.sh"

image=""
while (($#)); do
  case "$1" in
    --image) image="${2:-}"; shift 2 ;;
    *) echo "użycie: test-migrator.sh [--image <obraz>]" >&2; exit 2 ;;
  esac
done
if [[ -z "$image" ]]; then
  image="legatto-migrator:test-$$"
  docker build -q -f "$ROOT/docker/migrator/Dockerfile" -t "$image" "$ROOT" >/dev/null
  built=1
fi

work="$(mktemp -d)"
cleanup() {
  stack_down
  [[ -n "${built:-}" ]] && docker rmi -f "$image" >/dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT

# pg_dump ≥ 17.6 dopisuje losowy klucz `\restrict`/`\unrestrict` - poza porównaniem.
schema_sha() {
  docker exec "$STACK_DB" pg_dump -U supabase_admin -d postgres --schema-only --no-owner \
    --exclude-schema=supabase_migrations | grep -v -E '^\\(un)?restrict ' | shasum -a 256 | cut -d' ' -f1
}

expected="$(find "$ROOT/supabase/migrations" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"
stack_up legatto-migrator-test

echo "== 1. migrate (pierwsza instalacja)"
stack_migrator "$image" migrate 2>"$work/m1.log" || { tail -30 "$work/m1.log" >&2; fail "pierwszy migrate"; }
tail -1 "$work/m1.log"
grep -q "zastosowano $expected," "$work/m1.log" || fail "pierwszy migrate nie zastosował $expected migracji"

echo "== 2. check"
stack_migrator "$image" check 2>"$work/c1.log" || { cat "$work/c1.log" >&2; fail "check po migrate"; }
tail -1 "$work/c1.log"
grep -q '(0 do zastosowania)' "$work/c1.log" || fail "check widzi oczekujące migracje"

before="$(schema_sha)"
echo "== 3. migrate (drugi przebieg)"
stack_migrator "$image" migrate 2>"$work/m2.log" || { tail -30 "$work/m2.log" >&2; fail "drugi migrate"; }
tail -1 "$work/m2.log"
grep -q 'zastosowano 0,' "$work/m2.log" || fail "drugi migrate coś zastosował"
after="$(schema_sha)"
[[ "$before" == "$after" ]] || fail "schemat zmienił się po drugim migrate ($before → $after)"
echo "schemat bez zmian: sha256 $after"

echo "== 4. status --json"
status="$(stack_migrator "$image" status --json 2>/dev/null)"
echo "$status"
[[ "$status" == *"\"applied\":$expected,"* && "$status" == *'"pending":0,'* && "$status" == *'"valid":true'* ]] \
  || fail "status niezgodny z oczekiwanym (applied $expected, pending 0, valid true)"

echo "== 5. check ze zmienioną zastosowaną migracją"
cp -R "$ROOT/supabase/migrations" "$work/migrations"
first="$(find "$work/migrations" -maxdepth 1 -name '*.sql' | sort | head -n 1)"
printf '\n-- zmiana po zastosowaniu\n' >>"$first"
chmod -R a+rX "$work/migrations"
STACK_MIGRATOR_DOCKER_ARGS=(-v "$work/migrations:/migrations:ro")
set +e
stack_migrator "$image" check 2>"$work/c2.log"
code=$?
set -e
STACK_MIGRATOR_DOCKER_ARGS=()
tail -1 "$work/c2.log"
[[ "$code" == 10 ]] || fail "check ze zmienionym plikiem zwrócił $code zamiast 10"

echo "test-migrator: OK ($expected migracji; migrate → check → migrate bez zmian; zmieniony plik → 10)"

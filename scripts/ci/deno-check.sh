#!/usr/bin/env bash
# `deno check` każdej Edge Function z jej deno.json (te same importy co na Supabase Cloud).
# Bez zapisu lockfile'a (--no-lock): CI ani lokalny przebieg nie zmieniają deno.lock.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
failed=0
count=0
for dir in supabase/functions/*/; do
  fn="${dir%/}"
  [[ -f "$fn/index.ts" ]] || continue
  config=()
  [[ -f "$fn/deno.json" ]] && config=(--config "$fn/deno.json")
  count=$((count + 1))
  if deno check --no-lock ${config[@]+"${config[@]}"} "$fn/index.ts"; then
    echo "deno-check: OK ${fn##*/}"
  else
    echo "deno-check: FAIL ${fn##*/}" >&2
    failed=1
  fi
done
((count > 0)) || { echo "deno-check: brak funkcji" >&2; exit 1; }
exit "$failed"

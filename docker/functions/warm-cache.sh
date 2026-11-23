#!/bin/bash
# Zasiewa cache modułów edge-runtime w obrazie `functions` (build z siecią). W runtime kontener nie ma
# dostępu do registry npm/jsr: router (jsr:@panva/jose) i każda funkcja (npm:@supabase/supabase-js)
# muszą się załadować z cache zapisanego tutaj w warstwie obrazu.
#
# Uruchamia edge-runtime z routerem, wywołuje OPTIONS na każdej funkcji (tworzy workera, czyli
# rozwiązuje i pobiera cały graf modułów) i sprawdza, że żadna nie zgłosiła BOOT_ERROR.
set -euo pipefail

FUNCTIONS_DIR=/home/deno/functions
PORT=9000
LOG=/tmp/edge-runtime-warm.log

# Atrapy wymaganych zmiennych (moduły czytają je przy starcie); bez weryfikacji JWT.
export JWT_SECRET=warm-cache-only-not-a-secret-0000000000 SUPABASE_URL=http://127.0.0.1:1 \
  SUPABASE_ANON_KEY=warm SUPABASE_SERVICE_ROLE_KEY=warm VERIFY_JWT=false

edge-runtime start --main-service "$FUNCTIONS_DIR/main" --port "$PORT" >"$LOG" 2>&1 &
runtime_pid=$!
trap 'kill "$runtime_pid" 2>/dev/null || true' EXIT

# Odpowiedź HTTP przez /dev/tcp (obraz nie ma curl): status z pierwszej linii.
http_status() {
  local method=$1 path=$2 status
  exec 3<>"/dev/tcp/127.0.0.1/$PORT" || return 1
  printf '%s %s HTTP/1.1\r\nHost: localhost\r\nOrigin: http://localhost:3000\r\nAccess-Control-Request-Method: POST\r\nConnection: close\r\n\r\n' "$method" "$path" >&3
  IFS=' ' read -r _ status _ <&3 || status=000
  cat <&3 >/dev/null || true
  exec 3>&-
  printf '%s' "$status"
}

for _ in $(seq 1 120); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then break; fi
  if ! kill -0 "$runtime_pid" 2>/dev/null; then cat "$LOG" >&2; echo "warm-cache: edge-runtime nie wystartował" >&2; exit 1; fi
  sleep 1
done

failed=0
for dir in "$FUNCTIONS_DIR"/*/; do
  name=$(basename "$dir")
  case "$name" in main | _*) continue ;; esac
  status=$(http_status OPTIONS "/$name")
  echo "warm-cache: $name -> HTTP $status"
  if [ "$status" != "200" ] && [ "$status" != "204" ]; then failed=1; fi
done

if grep -q 'BOOT_ERROR\|worker boot error' "$LOG"; then failed=1; fi
if [ "$failed" -ne 0 ]; then
  cat "$LOG" >&2
  echo "warm-cache: nie każda funkcja wystartowała" >&2
  exit 1
fi
echo "warm-cache: cache zasiany w ${DENO_DIR:-domyślnym katalogu}"

#!/usr/bin/env bash
# End-to-end voice call check: 2 new accounts, 2 headless Chromium tabs with
# fake mics. A calls B → B accepts → audio both ways → A hangs up.
# Needs: docker stack + api (:7100) + media + client vite (:7104) running.
# Usage: [UI_URL=...] [CHROME_FLAGS=...] scripts/smoke-calls.sh [api_url]
set -euo pipefail
API=${1:-http://127.0.0.1:7100}
DEV='{"name":"call smoke","platform":"web"}'
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

account() {
  local email="callsmoke$(date +%s%N)@example.com" name="call_$1_$(date +%s%N | tail -c 7)" token
  token=$(curl -sf -X POST "$API/auth/register" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"Sm0ke-Test-Pass!\",\"device\":$DEV}" |
    python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
  curl -sf -X PUT "$API/me/username" -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' -d "{\"username\":\"$name\"}" >/dev/null
  printf '%s\n%s\n' "$token" "$name"
}

{ account a; account b; } >"$TMP/users.txt"
mkdir "$TMP/chrome"
node "$(dirname "$0")/smoke-calls.mjs" "$TMP/chrome" "$TMP/users.txt"

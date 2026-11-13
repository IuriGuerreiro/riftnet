#!/usr/bin/env bash
# End-to-end auth check against a running api + docker stack.
# Usage: scripts/smoke-auth.sh [api_url]
set -euo pipefail
API=${1:-http://127.0.0.1:7100}
EMAIL="smoke$(date +%s%N)@example.com"
PASS='Sm0ke-Test-Pass!'
DEV='{"name":"smoke test","platform":"desktop"}'
fail() { echo "❌ $*"; exit 1; }
ok() { echo "✅ $*"; }
post() { curl -s -o /tmp/smoke.body -w '%{http_code}' -X "${3:-POST}" "$API$1" -H 'Content-Type: application/json' ${AUTH:+-H "Authorization: Bearer $AUTH"} ${2:+-d "$2"}; }
field() { python3 -c "import sys,json;print(json.load(open('/tmp/smoke.body'))$1)"; }

[ "$(post /auth/register "{\"email\":\"$EMAIL\",\"password\":\"short\",\"device\":$DEV}")" = 400 ] && ok "weak password rejected" || fail "weak password"
[ "$(post /auth/register "{\"email\":\"nope\",\"password\":\"$PASS\",\"device\":$DEV}")" = 400 ] && ok "bad email rejected" || fail "bad email"

[ "$(post /auth/register "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"device\":$DEV}")" = 200 ] || fail "register: $(cat /tmp/smoke.body)"
[ "$(field "['user']['username']")" = None ] && ok "register → no username yet" || fail "username should be empty"
[ "$(post /auth/register "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"device\":$DEV}")" = 409 ] && ok "duplicate email → 409" || fail "dup email"

[ "$(post /auth/login "{\"email\":\"$EMAIL\",\"password\":\"wrong-password\",\"device\":$DEV}")" = 401 ] && ok "wrong password → 401" || fail "wrong pw"
[ "$(post /auth/login "{\"email\":\"ghost@example.com\",\"password\":\"$PASS\",\"device\":$DEV}")" = 401 ] && ok "unknown email → 401 (same as wrong password)" || fail "unknown email"
[ "$(post /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"device\":$DEV}")" = 200 ] && ok "login" || fail "login: $(cat /tmp/smoke.body)"
ACCESS=$(field "['access_token']"); REFRESH=$(field "['refresh_token']")

[ "$(post /me '' GET)" = 401 ] && ok "/me without token → 401" || fail "/me no token"
AUTH=garbage; [ "$(post /me '' GET)" = 401 ] && ok "/me with forged token → 401" || fail "forged token"
AUTH=$ACCESS; [ "$(post /me '' GET)" = 200 ] && ok "/me with token" || fail "/me"

NAME="smoke_$(date +%s%N | tail -c 9)"
[ "$(post /me/username "{\"username\":\"no spaces\"}" PUT)" = 400 ] && ok "invalid username → 400" || fail "invalid username"
[ "$(post /me/username "{\"username\":\"$NAME\"}" PUT)" = 200 ] && ok "username set" || fail "set username: $(cat /tmp/smoke.body)"
[ "$(field "['username']")" = "$NAME" ] || fail "username not saved"

unset AUTH
[ "$(post /auth/refresh "{\"refresh_token\":\"$REFRESH\"}")" = 200 ] && ok "refresh rotates tokens" || fail "refresh: $(cat /tmp/smoke.body)"
NEW_REFRESH=$(field "['refresh_token']")
[ "$(post /auth/refresh "{\"refresh_token\":\"$REFRESH\"}")" = 401 ] && ok "old refresh token reused → 401" || fail "reuse not detected"
[ "$(post /auth/refresh "{\"refresh_token\":\"$NEW_REFRESH\"}")" = 401 ] && ok "reuse revoked the device (new token dead too)" || fail "device not revoked"

[ "$(post /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"device\":$DEV}")" = 200 ] || fail "login 2"
AUTH=$(field "['access_token']"); R2=$(field "['refresh_token']")
[ "$(post /auth/logout '')" = 204 ] && ok "logout" || fail "logout"
unset AUTH
[ "$(post /auth/refresh "{\"refresh_token\":\"$R2\"}")" = 401 ] && ok "refresh after logout → 401" || fail "logout didn't revoke"

echo "🐒 all auth checks passed"

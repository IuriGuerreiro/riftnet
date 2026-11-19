#!/usr/bin/env bash
# WebSocket load test. Starts its own api on LT_PORT (default 7171) against a
# separate 'loadtest' Postgres database and Scylla keyspace, runs the steps,
# then stops that api. Needs: docker compose -f infra/docker-compose.yml up -d
#
#   scripts/loadtest.sh                     # 100, 250, 500, 1000 sockets
#   LT_STEPS=50,2000 LT_MESSAGES=10 scripts/loadtest.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${LT_PORT:-7171}"
WORK="$(mktemp -d)"
API_PID=""

cleanup() {
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID"
    wait "$API_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

safe_log_tail() {
  grep -viE "token|secret|password|authorization|bearer" "$WORK/api.log" | tail -n 20 || true
}

if port_in_use "$PORT"; then
  echo "port $PORT is already in use; pick another with LT_PORT=..." >&2
  exit 1
fi

cd "$ROOT"
cargo build --release -p api -p loadtest
BIN="$ROOT/target/release"

export API_SIGNING_KEY_FILE="$WORK/signing_key"
if port_in_use "$PORT"; then
  echo "port $PORT became busy during the build; aborting" >&2
  exit 1
fi
"$BIN/loadtest" reset

# Run from an empty dir so the api does not load the repo's .env, and keep
# telemetry off so nothing is sent to the observability stack.
(
  cd "$WORK"
  unset OTEL_EXPORTER_OTLP_ENDPOINT
  APP_ENV=development \
  API_ADDR="127.0.0.1:$PORT" \
  MACHINE_ID=11 \
  DATABASE_URL="postgres://app:app@127.0.0.1:55432/loadtest" \
  SCYLLA_KEYSPACE=loadtest \
  S3_BUCKET=loadtest \
  ZITADEL_PAT=unused \
  RATE_LIMITS=off \
  RUST_LOG=warn \
  exec "$BIN/api"
) >"$WORK/api.log" 2>&1 &
API_PID=$!

READY=""
for _ in $(seq 1 60); do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "the load-test api exited during startup. Last log lines:" >&2
    safe_log_tail >&2
    exit 1
  fi
  if curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [[ -z "$READY" ]]; then
  echo "the load-test api did not become healthy in 60s. Last log lines:" >&2
  safe_log_tail >&2
  exit 1
fi

LT_WS_URL="ws://127.0.0.1:$PORT/ws" "$BIN/loadtest" run

echo
echo "api warnings/errors during the run:"
grep -cE "WARN|ERROR" "$WORK/api.log" || true
grep -E "WARN|ERROR" "$WORK/api.log" | sed -E 's/.*(WARN|ERROR)/\1/' | sort | uniq -c | sort -rn | head -10 || true

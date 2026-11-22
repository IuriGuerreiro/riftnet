#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
api_binary=$(realpath -m "${CARGO_TARGET_DIR:-$repo/target}/debug/api")
if [[ ! -x "$api_binary" ]]; then
  echo "Build the verification API with cargo build --locked -p api"
  exit 1
fi

exec 9>"${XDG_RUNTIME_DIR:-/tmp}/discord-verify-$UID.lock"
if ! flock -n 9 || [[ -n "$(ss -H -ltn 'sport = :17100')" ]]; then
  echo "The verification stack is already running or API port 17100 is in use"
  exit 1
fi

evidence=$(mktemp -d "${TMPDIR:-/tmp}/discord-verification.XXXXXXXX")
scratch=$(mktemp -d)
project="discord-verify-${scratch##*.}"
project=${project,,}
compose=(docker compose -p "$project" -f "$scratch/docker-compose.yml")
api_pid=
stack_started=false

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  if $stack_started; then
    if ((status != 0)); then
      "${compose[@]}" logs --no-color >"$evidence/compose.log" 2>&1 || true
    fi
    "${compose[@]}" down -v >>"$evidence/setup.log" 2>&1 || status=1
  fi
  rm -r "$scratch"
  printf 'Evidence: %s\n' "$evidence"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir "$scratch/.secrets"
cp "$repo/infra/postgres-init.sql" "$scratch/"
sed -e 's/127\.0\.0\.1:55432:/127.0.0.1:15432:/' \
    -e 's/127\.0\.0\.1:\(9042\|4222\|8222\|6379\|710[267]\):/127.0.0.1:1\1:/g' \
    -e 's/--developer-mode 1$/--developer-mode 1 --reactor-backend epoll/' \
    -e 's/ZITADEL_EXTERNALPORT: 7102/ZITADEL_EXTERNALPORT: 17102/' \
    "$repo/infra/docker-compose.yml" >"$scratch/docker-compose.yml"

api_url=http://127.0.0.1:17100
stack_started=true
"${compose[@]}" up -d --wait --wait-timeout 180 >"$evidence/setup.log" 2>&1

for ((attempt = 0; attempt < 120; attempt++)); do
  if [[ -s "$scratch/.secrets/api.pat" ]] &&
    curl -fsS --max-time 2 http://localhost:17102/debug/ready >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ((attempt == 120)); then
  echo "Zitadel did not become ready"
  exit 1
fi

for ((attempt = 0; attempt < 30; attempt++)); do
  if "${compose[@]}" exec -T scylla cqlsh --connect-timeout=2 \
    -e 'SELECT release_version FROM system.local' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ((attempt == 30)); then
  echo "Scylla did not become ready"
  exit 1
fi

scylla_id=$("${compose[@]}" ps -q scylla)
scylla_ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$scylla_id")

cd "$scratch"
env -i PATH="$PATH" RATE_LIMITS="${VERIFY_RATE_LIMITS:-on}" API_ADDR=127.0.0.1:17100 \
  DATABASE_URL=postgres://app:app@127.0.0.1:15432/app \
  SCYLLA_NODES="$scylla_ip:9042" NATS_URL=nats://127.0.0.1:14222 \
  REDIS_URL=redis://127.0.0.1:16379 ZITADEL_URL=http://localhost:17102 \
  ZITADEL_PAT_FILE="$scratch/.secrets/api.pat" \
  API_SIGNING_KEY_FILE="$scratch/api-secrets/signing-key" \
  S3_ENDPOINT=http://127.0.0.1:17106 \
  "$api_binary" >"$evidence/api.log" 2>&1 &
api_pid=$!
for ((attempt = 0; attempt < 90; attempt++)); do
  kill -0 "$api_pid" 2>/dev/null || break
  if curl -fsS --max-time 2 "$api_url/health" >"$evidence/doctor.log" 2>/dev/null &&
    kill -0 "$api_pid" 2>/dev/null; then
    bash "$repo/scripts/smoke-auth.sh" "$api_url" 2>&1 | tee "$evidence/auth.log"
    if (($#)); then
      (cd "$repo"; API_HTTP="$api_url" "$@")
    fi
    exit 0
  fi
  sleep 1
done
echo "Verification API did not become ready"
exit 1

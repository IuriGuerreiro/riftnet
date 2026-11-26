#!/usr/bin/env bash
# Replaces one service (api or media) and restores the old image if it fails.
# Installed root-owned in /opt/adept-deploy by setup-deploy.sh.
#
# CI: no arguments. stdin lines: "status", or "deploy", digest, user, token.
# Root only: deploy.sh rollback | apply   (apply = re-read compose and .env)
set -euo pipefail
umask 077
cd -- "$(dirname -- "$(realpath -- "$0")")"
# shellcheck source=/dev/null
source ./config

fail() { echo "ERROR: $*" >&2; exit 1; }

container() { # service
  docker ps --all --quiet --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$1" --filter label=com.docker.compose.oneoff=False
}

label() { docker inspect --format "{{index .Config.Labels \"$2\"}}" "$1"; }

health() { docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1"; }

compose_up() { # image
  DEPLOY_IMAGE="$1" DEPLOY_PROJECT="$PROJECT" docker compose --project-name "$PROJECT" \
    --env-file "$ENV_FILE" --file compose.yml --file compose.deploy.yml \
    up --detach --no-build --pull never --no-deps --wait --wait-timeout "$WAIT_SECONDS" "$SERVICE"
}

public_ok() {
  [[ -n "$PUBLIC_HEALTH_URL" ]] || return 0
  local body
  for _ in {1..12}; do
    body=$(curl --fail --silent --show-error --max-time 10 "$PUBLIC_HEALTH_URL" || true)
    [[ "$body" == ok ]] && return 0
    sleep 5
  done
  echo "Public health check failed: $PUBLIC_HEALTH_URL"
  return 1
}

bring_up() { compose_up "$1" && public_ok; }

backup_postgres() {
  local pg file
  pg=$(container postgres)
  [[ -n "$pg" ]] || fail 'Postgres is not running. Nothing was changed.'
  mkdir -p "$BACKUP_DIR"
  file="$BACKUP_DIR/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  docker exec "$pg" pg_dumpall -U app | gzip > "$file.tmp" || fail 'Postgres backup failed. Nothing was changed.'
  gzip -dc "$file.tmp" | tail -n 5 | grep 'database cluster dump complete' > /dev/null \
    || fail 'Postgres backup is incomplete. Nothing was changed.'
  mv -- "$file.tmp" "$file"
  # Keep the newest 14 backups.
  find "${BACKUP_DIR:?}" -maxdepth 1 -type f -name 'pre-deploy-*' -printf '%f\n' | sort -r | tail -n +15 |
    while read -r name; do rm -f -- "${BACKUP_DIR:?}/$name"; done
  echo "Postgres backed up: $file"
}

# Keep only the running and previous images of this service.
clean_images() { # kept image ids
  local ref id repo tag digest
  docker image ls --digests --no-trunc --format '{{.Repository}} {{.Tag}} {{.Digest}} {{.ID}}' |
    while read -r repo tag digest id; do
      case "$repo" in
        "adept-rollback-$SERVICE") ref="$repo:$tag" ;;
        "$IMAGE_REPO") ref="$repo@$digest" ;;
        *) continue ;;
      esac
      [[ " $* " == *" $id "* ]] || docker image rm "$ref" > /dev/null 2>&1 || true
    done
}

replace() { # image, its id, running image id
  local image=$1 new_id=$2 old_id=$3 saved="adept-rollback-$SERVICE:${3#sha256:}" previous_id
  docker image tag "$old_id" "$saved" || fail 'Cannot save the running image. Nothing was changed.'
  [[ "$SERVICE" != api || "$MODE" == rollback ]] || backup_postgres

  printf '%s\n' "$saved" > in-progress.tmp
  mv -- in-progress.tmp in-progress

  echo "Replacing $SERVICE"
  if bring_up "$image"; then
    if [[ "$new_id" != "$old_id" ]]; then
      printf '%s\n' "$saved" > previous.tmp
      mv -- previous.tmp previous
    fi
    if [[ -s previous ]] && previous_id=$(docker image inspect --format '{{.Id}}' "$(cat previous)"); then
      clean_images "$new_id" "$previous_id"
    fi
    rm -f -- in-progress
    echo "OK: $SERVICE is healthy"
    return 0
  fi

  echo "FAILED: $SERVICE is not healthy. Restoring the previous image."
  # CI output can be public, so app logs stay on this machine.
  docker logs --tail 200 "$(container "$SERVICE")" > last-failure.log 2>&1 || true
  echo "App logs are on the machine: $PWD/last-failure.log"
  if bring_up "$saved"; then
    rm -f -- in-progress
    echo "RESTORED: $SERVICE is back on the previous image. Migrations were not undone."
  else
    echo "RESTORE FAILED: $SERVICE needs a person now."
  fi
  return 1
}

# Internal: the detached worker. Holds the lock through inherited fd 9.
if [[ "${1:-}" == _work && $# == 5 ]]; then
  MODE=$2
  trap '' HUP INT TERM PIPE
  replace "$3" "$4" "$5"
  exit
fi

case $# in
  0) read -r MODE || fail 'Bad request.'
     [[ "$MODE" == deploy || "$MODE" == status ]] || fail 'Bad request.' ;;
  1) MODE=$1; [[ "$MODE" == rollback || "$MODE" == apply ]] || fail 'Usage: deploy.sh [rollback|apply]' ;;
  *) fail 'Usage: deploy.sh [rollback|apply]' ;;
esac

if [[ "$MODE" == status ]]; then
  current=$(container "$SERVICE")
  [[ -n "$current" ]] || fail "No $SERVICE container in project $PROJECT."
  echo "revision=$(label "$current" org.opencontainers.image.revision)"
  echo "fingerprint=$(label "$current" adept.fingerprint)"
  echo "health=$(health "$current")"
  echo "config=$(cat compose.yml compose.deploy.yml deploy.sh | sha256sum | cut -d' ' -f1)"
  exit 0
fi

exec 9> deploy.lock
flock --wait 900 9 || fail 'Another deploy is still running.'

current=$(container "$SERVICE")
[[ -n "$current" && "$current" != *$'\n'* ]] || fail "Expected one $SERVICE container in project $PROJECT. Nothing was changed."
[[ -r "$ENV_FILE" ]] || fail "Cannot read $ENV_FILE. Nothing was changed."
old_id=$(docker inspect --format '{{.Image}}' "$current")
# Left by a run that died halfway: the running image was never proven good.
if [[ -s in-progress ]]; then
  echo 'The last deploy was interrupted. Using the image from before it as the fallback.'
  old_id=$(docker image inspect --format '{{.Id}}' "$(cat in-progress)")
fi

case "$MODE" in
  deploy)
    { read -r digest && read -r user && read -r token; } || fail 'Bad deploy request.'
    [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ && "$user" =~ ^[A-Za-z0-9-]+(\[bot\])?$ && -n "$token" ]] || fail 'Bad deploy request.'
    image="$IMAGE_REPO@$digest"
    registry_config=$(mktemp -d)
    trap 'rm -rf -- "${registry_config:?}"' EXIT
    printf '%s' "$token" | docker --config "$registry_config" login "${IMAGE_REPO%%/*}" --username "$user" --password-stdin > /dev/null 2>&1 \
      || fail 'Registry login failed. Nothing was changed.'
    unset token
    docker --config "$registry_config" pull --quiet "$image" || fail 'Image pull failed. Nothing was changed.'
    ;;
  rollback)
    [[ -s previous ]] || fail 'No previous image saved.'
    read -r image < previous
    ;;
  apply)
    image="adept-rollback-$SERVICE:${old_id#sha256:}"
    docker image tag "$old_id" "$image"
    ;;
esac

new_id=$(docker image inspect --format '{{.Id}}' "$image")
if [[ "$MODE" == deploy && ! -s in-progress && "$new_id" == "$old_id" && "$(health "$current")" == healthy ]]; then
  public_ok
  echo "OK: $SERVICE already runs this image"
  exit 0
fi

# From here a dropped connection or a cancelled run must not stop halfway: the
# work runs in its own session and writes to a file, and we only follow the file.
log=last-deploy.log
: > "$log"
setsid "./$(basename -- "$0")" _work "$MODE" "$image" "$new_id" "$old_id" > "$log" 2>&1 < /dev/null &
worker=$!
tail --lines=+1 --follow --pid="$worker" "$log" || true
wait "$worker"
